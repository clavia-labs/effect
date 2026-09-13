import { assert, describe, it } from "@effect/vitest"
import { AnthropicClient, AnthropicLanguageModel } from "@tardie/ai-anthropic"
import { OpenAiClient, OpenAiLanguageModel } from "@tardie/ai-openai"
import { OpenAiClient as CompatClient, OpenAiLanguageModel as CompatLanguageModel } from "@tardie/ai-openai-compat"
import { OpenRouterClient, OpenRouterLanguageModel } from "@tardie/ai-openrouter"
import { ResponseFormat } from "@tardie/ai/LanguageModel"
import { Effect, Layer, Redacted, Result, Schema, Stream } from "effect"
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

const fixture = (
  provider: Provider,
  scenario: Scenario,
  segmented = false,
  reasoningField = "reasoning_content",
  overrides: { events?: Array<Record<string, unknown>>; config?: Record<string, unknown> } = {}
) => {
  const requests: Array<unknown> = []
  const events = overrides.events ?? eventsFor(provider, scenario, reasoningField)
  const text =
    events.map((event, sequence_number) => `data: ${JSON.stringify({ sequence_number, ...event })}\n\n`).join("") +
    ((provider === "compat" || provider === "openrouter") ? "data: [DONE]\n\n" : "")
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
    ? OpenAiLanguageModel.layer({ model: "fixture", config: overrides.config }).pipe(
      Layer.provide(OpenAiClient.layer(client))
    )
    : provider === "anthropic"
    ? AnthropicLanguageModel.layer({ model: "fixture", config: { structuredOutputs: true, ...overrides.config } }).pipe(
      Layer.provide(AnthropicClient.layer(client))
    )
    : provider === "openrouter"
    ? OpenRouterLanguageModel.layer({ model: "fixture", config: overrides.config }).pipe(
      Layer.provide(OpenRouterClient.layer(client))
    )
    : CompatLanguageModel.layer({ model: "fixture", config: overrides.config }).pipe(
      Layer.provide(CompatClient.layer(client))
    )
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

for (const provider of ["openai", "anthropic", "compat", "openrouter"] as const) {
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
          if (provider === "openrouter") {
            assert.strictEqual(finish?.metadata.openrouter?.provider, "Anthropic")
            assert.strictEqual(finish?.metadata.openrouter?.usage?.cost, 0.5)
          }
          if (provider === "openai" || provider === "compat") {
            assert.strictEqual(finish?.metadata.openai?.usage?.cost, 0.5)
          }
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
          if (provider === "compat" || provider === "openrouter") {
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
        if (provider === "openai" || provider === "anthropic") {
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
          if (provider === "openrouter") {
            assert.include(replay, "\"signature\":\"signed\"")
            assert.include(replay, "\"reasoning_details\":")
          }
          if (provider === "compat") assert.include(replay, `"${field}":"Check"`)
          for (const id of ["a", "b", "c"]) {
            assert.include(replay, `"${provider === "openai" ? "call_id" : "id"}":"${id}"`)
          }
        }))
    }
  })
}

for (const store of [false, true]) {
  it.effect(`preserves explicit OpenAI includes for model aliases (store=${store})`, () =>
    Effect.gen(function*() {
      const { stream, requests } = fixture("openai", "valid", false, "reasoning", {
        config: { store, include: ["reasoning.encrypted_content", "message.output_text.logprobs"] }
      })
      yield* Stream.runCollect(stream())
      assert.deepStrictEqual((requests[0] as { include: unknown }).include, [
        "reasoning.encrypted_content",
        "message.output_text.logprobs"
      ])
    }))
}

it.effect("rejects multiple compatible choices before sending a request", () =>
  Effect.gen(function*() {
    const { stream, requests } = fixture("compat", "valid", false, "reasoning", { config: { n: 2 } })
    const result = yield* Stream.runCollect(stream()).pipe(Effect.result)
    assert.isTrue(Result.isFailure(result))
    assert.strictEqual(requests.length, 0)
  }))

it.effect("does not concatenate unexpected alternative choices", () =>
  Effect.gen(function*() {
    const events = [0, 1].map((index) => ({
      id: "r",
      model: "fixture",
      created: 1,
      choices: [{ index, delta: { content: index === 0 ? "FIRST" : "SECOND" }, finish_reason: "stop" }]
    }))
    const { stream } = fixture("compat", "valid", false, "reasoning", { events })
    const result = yield* Stream.runCollect(stream()).pipe(Effect.result)
    assert.isTrue(Result.isFailure(result))
  }))

for (const input of [undefined, null, 0]) {
  it.effect(`accepts partial Anthropic usage while retaining prior counters (input=${input})`, () =>
    Effect.gen(function*() {
      const events = eventsFor("anthropic", "valid").map((event) =>
        "type" in event && event.type === "message_delta"
          ? { ...event, usage: { output_tokens: 5, ...(input === undefined ? {} : { input_tokens: input }) } }
          : event
      )
      const { stream } = fixture("anthropic", "valid", true, "reasoning", { events })
      const parts = yield* Stream.runCollect(stream())
      const finish = parts.find((part) => part.type === "finish")
      assert.strictEqual(finish?.usage.inputTokens.total, input === 0 ? 0 : 10)
      assert.strictEqual(finish?.usage.outputTokens.total, 5)
    }))
}

for (const effort of ["max", "xhigh"]) {
  it.effect(`sends native Anthropic effort and automatic cache control (${effort})`, () =>
    Effect.gen(function*() {
      const { stream, requests } = fixture("anthropic", "valid", false, "reasoning", {
        config: { output_config: { effort }, cache_control: { type: "ephemeral" } }
      })
      yield* Stream.runCollect(stream())
      assert.strictEqual((requests[0] as { output_config: { effort: string } }).output_config.effort, effort)
      assert.deepStrictEqual((requests[0] as { cache_control: unknown }).cache_control, { type: "ephemeral" })
    }))
}
