import { assert, describe, it } from "@effect/vitest"
import { OpenAiClient, OpenAiLanguageModel } from "@tardie/ai-openai"
import { attachFileStream, streamedRequestBody } from "@tardie/ai-openai/internal/requestBody"
import { Effect, Layer, Stream } from "effect"
import { LanguageModel, Prompt } from "effect/unstable/ai"
import { HttpBody, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

const response = {
  id: "fixture",
  created_at: 1,
  model: "fixture",
  status: "completed",
  output: [],
  usage: {
    input_tokens: 1,
    output_tokens: 0,
    total_tokens: 1,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 }
  }
}
const frames = `data: ${JSON.stringify({ type: "response.completed", sequence_number: 0, response })}\n\n`

const fixture = (
  transform = (request: HttpClientRequest.HttpClientRequest) => request,
  chunkBytes = 5,
  streamFiles = true,
  imageUrlToStream?: OpenAiClient.Options["imageUrlToStream"]
) => {
  const bodies: Array<string> = []
  const tags: Array<string> = []
  const lengths: Array<number> = []
  const http = HttpClient.make((request) =>
    Effect.gen(function*() {
      const current = transform(request)
      tags.push(current.body._tag)
      const parts = current.body._tag === "Stream"
        ? yield* Stream.runCollect(current.body.stream).pipe(Effect.orDie)
        : current.body._tag === "Uint8Array"
        ? [current.body.body]
        : []
      lengths.push(...parts.map((part) => part.byteLength))
      bodies.push(parts.map((part) => new TextDecoder().decode(part)).join(""))
      return HttpClientResponse.fromWeb(
        current,
        new Response(frames, { headers: { "content-type": "text/event-stream" } })
      )
    })
  )
  const layer = OpenAiLanguageModel.layer({ model: "fixture" }).pipe(
    Layer.provide(OpenAiClient.layer({ requestBodyChunkBytes: chunkBytes, streamFiles, imageUrlToStream })),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http))
  )
  const run = (prompt: Prompt.Prompt) =>
    LanguageModel.streamText({ prompt }).pipe(Stream.runDrain, Effect.provide(layer))
  return { bodies, tags, lengths, run }
}

describe("streamed file requests", () => {
  it.effect("keeps image and document request bytes identical across chunk boundaries", () =>
    Effect.gen(function*() {
      const images = Array.from({ length: 10 }, (_, index) =>
        Uint8Array.from({ length: 127 + index }, (_, at) => (at + index) % 256))
      const prompt = () =>
        Prompt.make([
          {
            role: "user",
            content: [
              Prompt.textPart({ text: "Unicode 한글, quote \" and newline\n" }),
              ...images.map((bytes) =>
                Prompt.filePart({ mediaType: "image/png", data: bytes })
              ),
              Prompt.filePart({ mediaType: "application/pdf", fileName: "a\"b.pdf", data: images[0] })
            ]
          },
          {
            role: "assistant",
            content: [Prompt.toolCallPart({ id: "call", name: "read", params: {}, providerExecuted: false })]
          },
          {
            role: "tool",
            content: [
              Prompt.toolResultPart({
                id: "call",
                name: "read",
                isFailure: false,
                providerExecuted: false,
                result: {
                  type: "content",
                  value: [Prompt.filePart({ mediaType: "image/jpeg", data: images[0] })]
                }
              })
            ]
          }
        ])
      const buffered = fixture(undefined, 5, false)
      const test = fixture()
      yield* buffered.run(prompt())
      yield* test.run(prompt())
      assert.deepStrictEqual(buffered.tags, ["Uint8Array"])
      assert.deepStrictEqual(test.tags, ["Stream"])
      assert.strictEqual(test.bodies[0], buffered.bodies[0])
      assert.strictEqual(JSON.parse(test.bodies[0]).stream, true)
    }))

  it.effect("resolves image URLs lazily while preserving buffered request bytes", () =>
    Effect.gen(function*() {
      const images = Array.from({ length: 10 }, (_, index) => new Uint8Array(128 + index).fill(index))
      let reads = 0
      const buffered = fixture(undefined, 5, false)
      const lazy = fixture(
        (request) => {
          assert.strictEqual(reads, 0)
          return request
        },
        5,
        false,
        (url) =>
          url.protocol === "image-object:"
            ? Stream.fromEffect(Effect.sync(() => {
              reads++
              return images[Number(url.pathname.slice(1))]
            }))
            : undefined
      )
      const prompt = (urls: boolean) =>
        Prompt.make([{
          role: "user",
          content: images.map((bytes, index) =>
            Prompt.filePart({
              mediaType: "image/png",
              data: urls ? new URL(`image-object://fixture/${index}`) : bytes
            })
          )
        }])
      yield* buffered.run(prompt(false))
      yield* lazy.run(prompt(true))
      assert.strictEqual(reads, 10)
      assert.deepStrictEqual(lazy.tags, ["Stream"])
      assert.strictEqual(lazy.bodies[0], buffered.bodies[0])
      const forwarded = fixture(undefined, 5, false, () => undefined)
      yield* forwarded.run(
        Prompt.make([{
          role: "user",
          content: [Prompt.filePart({ mediaType: "image/png", data: new URL("https://fixture.invalid/image.png") })]
        }])
      )
      assert.deepStrictEqual(forwarded.tags, ["Uint8Array"])
      assert.strictEqual(
        JSON.parse(forwarded.bodies[0]).input[0].content[0].image_url,
        "https://fixture.invalid/image.png"
      )
    }))

  it.effect("preserves cold sources through metadata profiling and retry rebuilds", () =>
    Effect.gen(function*() {
      let pulls = 0
      const bytes = new Uint8Array([0, 1, 2, 253, 254, 255])
      const file = Stream.fromEffect(Effect.sync(() => {
        pulls++
        return bytes
      }))
      const block = attachFileStream({ type: "input_image", image_url: "data:image/png;base64," }, "image_url", file)
      const original = HttpClientRequest.post("https://fixture.invalid/responses", {
        body: streamedRequestBody({ input: [{ content: [block] }], service_tier: "flex" }, 2)
      })
      const metadata = OpenAiClient.getRequestBody(original) as {
        input: Array<{ content: Array<typeof block> }>
        service_tier: string
      }
      const json = {
        ...metadata,
        input: metadata.input.map((item) => ({
          ...item,
          content: item.content.map((part) => ({ ...part, detail: "auto" }))
        })),
        service_tier: "default"
      }
      assert.strictEqual(pulls, 0)
      const rebuilt = OpenAiClient.setRequestBody(original, json)
      if (rebuilt.body._tag !== "Stream") return yield* Effect.die("Expected streamed request body")
      const consume = Stream.runCollect(rebuilt.body.stream).pipe(
        Effect.map((parts) => parts.map((part) => new TextDecoder().decode(part)).join(""))
      )
      const first = yield* consume
      const second = yield* consume
      assert.strictEqual(pulls, 2)
      assert.strictEqual(first, second)
      assert.deepStrictEqual(JSON.parse(first), {
        input: [{ content: [{ type: "input_image", image_url: "data:image/png;base64,AAEC/f7/", detail: "auto" }] }],
        service_tier: "default"
      })
    }))

  it.effect("does not consume a later file before the current file finishes", () =>
    Effect.gen(function*() {
      let first = 0, second = 0, finalized = 0
      const block = (source: Stream.Stream<Uint8Array, Error>) =>
        attachFileStream({ image_url: "data:image/png;base64," }, "image_url", source)
      const body = streamedRequestBody([
        block(
          Stream.fromEffect(Effect.sync(() => {
            first++
            return new Uint8Array(32)
          })).pipe(Stream.ensuring(Effect.sync(() => {
            finalized++
          })))
        ),
        block(Stream.fromEffect(Effect.sync(() => {
          second++
          return new Uint8Array(32)
        })))
      ], 3)
      assert.strictEqual(first, 0)
      yield* body.stream.pipe(Stream.takeUntil((bytes) => new TextDecoder().decode(bytes) === "AAAA"), Stream.runDrain)
      assert.strictEqual(first, 1)
      assert.strictEqual(second, 0)
      assert.strictEqual(finalized, 1)
    }))

  it.effect("rejects streaming for legacy custom clients before dispatch", () =>
    Effect.gen(function*() {
      let calls = 0
      const legacy = OpenAiClient.OpenAiClient.of({
        streamFiles: true,
        client: HttpClient.make(() => Effect.die("Unexpected HTTP request")),
        createResponse: () =>
          Effect.sync(() => {
            calls++
          }).pipe(Effect.andThen(Effect.die("Unexpected response"))),
        createResponseStream: () =>
          Effect.sync(() => {
            calls++
          }).pipe(Effect.andThen(Effect.die("Unexpected stream"))),
        createEmbedding: () => Effect.die("Unexpected embedding")
      })
      const layer = OpenAiLanguageModel.layer({ model: "fixture" }).pipe(
        Layer.provide(Layer.succeed(OpenAiClient.OpenAiClient, legacy))
      )
      const prompt = Prompt.make([{
        role: "user",
        content: [Prompt.filePart({ mediaType: "image/png", data: new Uint8Array([1, 2, 3]) })]
      }])
      const unary = yield* LanguageModel.generateText({ prompt }).pipe(Effect.provide(layer), Effect.result)
      const streaming = yield* LanguageModel.streamText({ prompt }).pipe(
        Stream.runDrain,
        Effect.provide(layer),
        Effect.result
      )
      assert.strictEqual(unary._tag, "Failure")
      assert.strictEqual(streaming._tag, "Failure")
      assert.strictEqual(calls, 0)
    }))

  it.effect("rejects streamed WebSocket requests before dispatch", () =>
    Effect.gen(function*() {
      const test = fixture()
      const result = yield* test.run(
        Prompt.make([{
          role: "user",
          content: [Prompt.filePart({ mediaType: "image/png", data: new Uint8Array([1, 2, 3]) })]
        }])
      ).pipe(
        Effect.provideService(OpenAiClient.OpenAiSocket, {
          createResponseStream: () => Effect.die("Unexpected socket call")
        }),
        Effect.result
      )
      assert.strictEqual(result._tag, "Failure")
      assert.deepStrictEqual(test.bodies, [])
    }))

  it.effect("normalizes optional metadata before adding fields in a request transform", () =>
    Effect.gen(function*() {
      const bytes = new Uint8Array([1, 2, 3])
      const source = Stream.succeed(bytes)
      const streamed = attachFileStream(
        { type: "input_image", image_url: "data:image/png;base64," },
        "image_url",
        source
      )
      const json = (block: object) => ({
        service_tier: undefined,
        input: [{ content: [block] }],
        parallel_tool_calls: undefined,
        prompt_cache_options: undefined
      })
      const plain = HttpClientRequest.post("/responses", {
        body: HttpBody.jsonUnsafe(json({ type: "input_image", image_url: "data:image/png;base64,AQID" }))
      })
      const streaming = HttpClientRequest.post("/responses", { body: streamedRequestBody(json(streamed), 3) })
      const bodies: Array<string> = []
      for (const request of [plain, streaming]) {
        const metadata = OpenAiClient.getRequestBody(request) as Record<string, unknown>
        assert.isFalse(Object.hasOwn(metadata, "service_tier"))
        metadata.service_tier = "flex"
        metadata.parallel_tool_calls = false
        metadata.prompt_cache_options = { mode: "implicit" }
        const rebuilt = OpenAiClient.setRequestBody(request, metadata)
        const body = rebuilt.body
        const parts = body._tag === "Stream"
          ? yield* Stream.runCollect(body.stream)
          : body._tag === "Uint8Array"
          ? [body.body]
          : []
        bodies.push(parts.map((part) => new TextDecoder().decode(part)).join(""))
      }
      assert.strictEqual(bodies[1], bodies[0])
    }))

  it.effect("stops a failed source without reading subsequent files", () =>
    Effect.gen(function*() {
      let second = 0
      const failed = attachFileStream(
        { image_url: "data:image/png;base64," },
        "image_url",
        Stream.fail(new Error("storage failed"))
      )
      const later = attachFileStream(
        { image_url: "data:image/png;base64," },
        "image_url",
        Stream.fromEffect(Effect.sync(() => {
          second++
          return new Uint8Array(1)
        }))
      )
      const result = yield* Stream.runCollect(streamedRequestBody([failed, later], 7).stream).pipe(Effect.result)
      assert.strictEqual(result._tag, "Failure")
      assert.strictEqual(second, 0)
    }))
})
