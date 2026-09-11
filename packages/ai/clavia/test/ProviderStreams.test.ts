import { AnthropicClient, AnthropicLanguageModel } from "@clavia/ai-anthropic"
import { OpenAiClient, OpenAiLanguageModel } from "@clavia/ai-openai"
import { OpenAiClient as CompatClient, OpenAiLanguageModel as CompatLanguageModel } from "@clavia/ai-openai-compat"
import { ResponseFormat } from "@clavia/ai/LanguageModel"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Redacted, Schema, Stream } from "effect"
import { LanguageModel, Prompt, Response as AiResponse, Tool, Toolkit } from "effect/unstable/ai"
import { HttpClient, type HttpClientError, HttpClientResponse } from "effect/unstable/http"
import { eventsFor, type Provider, type Scenario } from "./utils/streams.ts"

const format = { type: "json", objectName: "answer", schema: Schema.Struct({ answer: Schema.String }) } as const
const validationError = Schema.Struct({
  _tag: Schema.Literal("ToolCallValidationError"),
  id: Schema.String,
  name: Schema.String,
  params: Schema.Unknown
})

const fixture = (provider: Provider, scenario: Scenario, segmented = false, reasoningField = "reasoning_content") => {
  const requests: Array<unknown> = []
  const events = eventsFor(provider, scenario, reasoningField)
  const text =
    events.map((event, sequence_number) => `data: ${JSON.stringify({ sequence_number, ...event })}\n\n`).join("") +
    (provider === "compat" ? "data: [DONE]\n\n" : "")
  const bytes = new TextEncoder().encode(text)
  const http = HttpClient.makeWith(
    Effect.fnUntraced(function*(requestEffect) {
      const request = yield* requestEffect
      assert.strictEqual(request.body._tag, "Uint8Array")
      if (request.body._tag === "Uint8Array") requests.push(JSON.parse(new TextDecoder().decode(request.body.body)))
      return HttpClientResponse.fromWeb(
        request,
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const size = segmented ? 7 : bytes.length
              for (let offset = 0; offset < bytes.length; offset += size) {
                controller.enqueue(bytes.slice(offset, offset + size))
              }
              controller.close()
            }
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
      )
    }),
    Effect.succeed as HttpClient.HttpClient.Preprocess<HttpClientError.HttpClientError, never>
  )
  const client = { apiKey: Redacted.make("fixture"), apiUrl: "https://fixture.invalid" }
  const providerLayer = provider === "openai"
    ? OpenAiLanguageModel.layer({ model: "fixture" }).pipe(Layer.provide(OpenAiClient.layer(client)))
    : provider === "anthropic"
    ? AnthropicLanguageModel.layer({ model: "fixture", config: { structuredOutputs: true } }).pipe(
      Layer.provide(AnthropicClient.layer(client))
    )
    : CompatLanguageModel.layer({ model: "fixture" }).pipe(Layer.provide(CompatClient.layer(client)))
  const layer = providerLayer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, http)))
  const stream = (prompt: Prompt.RawInput = "Read", failureMode: "return" | "error" = "return", dynamic = false) =>
    LanguageModel.streamText({
      prompt,
      toolkit: Toolkit.make(
        dynamic
          ? Tool.dynamic("read", { parameters: Schema.Struct({ path: Schema.String }), failureMode })
          : Tool.make("read", { parameters: Schema.Struct({ path: Schema.String }), failureMode })
      ),
      disableToolCallResolution: true
    }).pipe(Stream.provideService(ResponseFormat, format), Stream.provide(layer))
  return { stream, requests }
}

for (const provider of ["openai", "anthropic", "compat"] as const) {
  describe(provider, () => {
    it.effect("validates native dynamic tools without a provider bypass", () =>
      Effect.gen(function*() {
        const { stream } = fixture(provider, "invalid")
        const parts = yield* Stream.runCollect(stream("Read", "return", true))
        assert.deepStrictEqual(parts.filter((part) => part.type === "tool-call").map((part) => part.id), ["a", "c"])
        assert.strictEqual(parts.filter((part) => part.type === "error").length, 1)
      }))

    for (const segmented of [false, true]) {
      it.effect(`retains A and C, rejected B, and usage with segmented=${segmented}`, () =>
        Effect.gen(function*() {
          const { stream, requests } = fixture(provider, "invalid", segmented)
          const parts = yield* Stream.runCollect(stream())
          assert.deepStrictEqual(parts.filter((part) => part.type === "tool-call").map((part) => part.id), ["a", "c"])
          const errors = parts.filter((part) => part.type === "error")
          assert.strictEqual(errors.length, 1)
          const error = Schema.decodeUnknownSync(validationError)(errors[0]?.error)
          assert.deepStrictEqual(error, {
            _tag: "ToolCallValidationError",
            id: "b",
            name: "read",
            params: { path: 123 }
          })
          const finish = parts.find((part) => part.type === "finish")
          assert.strictEqual(finish?.reason, "tool-calls")
          assert.strictEqual(finish?.usage.inputTokens.total, 10)
          assert.strictEqual(finish?.usage.outputTokens.total, 5)
          if (provider !== "anthropic") assert.strictEqual(finish?.metadata.openai?.usage?.cost, 0.5)
          const wire = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(requests[0])
          if (provider === "openai") {
            assert.deepStrictEqual(
              Schema.decodeUnknownSync(
                Schema.Struct({ text: Schema.Struct({ format: Schema.Struct({ type: Schema.String }) }) })
              )(wire).text.format.type,
              "json_schema"
            )
          }
          if (provider === "anthropic") {
            assert.deepStrictEqual(
              Schema.decodeUnknownSync(
                Schema.Struct({ output_config: Schema.Struct({ format: Schema.Struct({ type: Schema.String }) }) })
              )(wire).output_config.format.type,
              "json_schema"
            )
          }
          if (provider === "compat") {
            assert.deepStrictEqual(
              Schema.decodeUnknownSync(Schema.Struct({ response_format: Schema.Struct({ type: Schema.String }) }))(wire)
                .response_format.type,
              "json_schema"
            )
          }
        }))
    }

    it.effect("keeps default validation failure fatal", () =>
      Effect.gen(function*() {
        const { stream } = fixture(provider, "invalid")
        const result = yield* Effect.result(Stream.runCollect(stream("Read", "error")))
        assert.strictEqual(result._tag, "Failure")
        if (result._tag === "Failure") assert.strictEqual(result.failure.reason._tag, "InvalidOutputError")
      }))

    for (const scenario of ["length", "partial-length"] as const) {
      it.effect(`preserves completion and usage for ${scenario}`, () =>
        Effect.gen(function*() {
          const { stream } = fixture(provider, scenario, true)
          const parts = yield* Stream.runCollect(stream())
          const finish = parts.find((part) => part.type === "finish")
          assert.strictEqual(finish?.reason, "length")
          assert.strictEqual(finish?.usage.inputTokens.total, 10)
          assert.strictEqual(finish?.usage.outputTokens.total, 5)
          if (provider === "compat") assert.deepStrictEqual(parts.filter((part) => part.type === "tool-call"), [])
        }))
    }

    it.effect("fails malformed JSON on normal completion", () =>
      Effect.gen(function*() {
        const { stream } = fixture(provider, "malformed")
        const seen: Array<AiResponse.AnyPart> = []
        const result = yield* Effect.result(
          stream().pipe(
            Stream.tap((part) =>
              Effect.sync(() => {
                seen.push(part)
              })
            ),
            Stream.runCollect
          )
        )
        assert.strictEqual(result._tag, "Failure")
        if (result._tag === "Failure") assert.strictEqual(result.failure.reason._tag, "ToolParameterValidationError")
        if (provider !== "compat") {
          assert.strictEqual(seen.find((part) => part.type === "finish")?.usage.outputTokens.total, 5)
        }
      }))

    for (const field of provider === "compat" ? ["reasoning", "reasoning_content"] : ["native"]) {
      it.effect(`replays ${field} reasoning and all calls after JSON restoration`, () =>
        Effect.gen(function*() {
          const { stream, requests } = fixture(provider, "invalid", false, field)
          const parts = yield* Stream.runCollect(stream())
          const prompt = Prompt.fromResponseParts(parts.map((part) => {
            if (part.type !== "error") return part
            const error = Schema.decodeUnknownSync(validationError)(part.error)
            return AiResponse.makePart("tool-call", {
              id: error.id,
              name: "read",
              params: error.params,
              providerExecuted: false
            })
          }))
          const restored = Schema.decodeUnknownSync(Prompt.Prompt)(JSON.parse(JSON.stringify(prompt)))
          const results = Prompt.make([{
            role: "tool",
            content: ["a", "b", "c"].map((id) => ({
              type: "tool-result",
              id,
              name: "read",
              result: "result",
              isFailure: id === "b"
            }))
          }])
          yield* Stream.runDrain(stream(Prompt.concat(restored, results)))
          const replay = JSON.stringify(requests[1])
          if (provider === "openai") assert.include(replay, "\"encrypted_content\":\"opaque-a\"")
          if (provider === "anthropic") assert.include(replay, "\"signature\":\"signed\"")
          if (provider === "compat") assert.include(replay, `"${field}":"Check"`)
          for (const id of ["a", "b", "c"]) {
            assert.include(replay, `"${provider === "openai" ? "call_id" : "id"}":"${id}"`)
          }
        }))
    }
  })
}
