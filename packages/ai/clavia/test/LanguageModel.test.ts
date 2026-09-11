import { assert, it } from "@effect/vitest"
import { make, ResponseFormat } from "@tardie/ai/LanguageModel"
import { Effect, Schema, Stream } from "effect"
import { LanguageModel, Tool, Toolkit } from "effect/unstable/ai"

const format = { type: "json", objectName: "answer", schema: Schema.Struct({ answer: Schema.String }) } as const

it.effect("isolates concurrent response formats on the upstream service", () =>
  Effect.gen(function*() {
    const seen = new Map<string, LanguageModel.ProviderOptions["responseFormat"]>()
    const model = yield* make({
      generateText: () => Effect.succeed([]),
      streamText: (options) =>
        Stream.fromEffect(Effect.sync(() => {
          const message = options.prompt.content[0]
          assert.strictEqual(message?.role, "user")
          if (message?.role === "user") {
            const part = message.content[0]
            if (part?.type === "text") seen.set(part.text, options.responseFormat)
          }
          return { type: "text-start", id: "text" } as const
        }))
    })
    yield* Effect.all([
      LanguageModel.streamText({ prompt: "json" }).pipe(Stream.runDrain, Effect.provideService(ResponseFormat, format)),
      LanguageModel.streamText({ prompt: "text" }).pipe(Stream.runDrain)
    ], { concurrency: "unbounded" }).pipe(Effect.provideService(LanguageModel.LanguageModel, model))
    assert.strictEqual(seen.get("json"), format)
    assert.deepStrictEqual(seen.get("text"), { type: "text" })
  }))

it.effect("applies text formats while object generation retains its schema and decoding", () =>
  Effect.gen(function*() {
    const seen: Array<LanguageModel.ProviderOptions["responseFormat"]> = []
    const model = yield* make({
      generateText: (options) =>
        Effect.sync(() => {
          seen.push(options.responseFormat)
          return [{ type: "text", text: "{\"value\":\"ok\"}" }]
        }),
      streamText: () => Stream.empty
    })
    yield* model.generateText({ prompt: "text" }).pipe(Effect.provideService(ResponseFormat, format))
    const result = yield* model.generateObject({ prompt: "object", schema: Schema.Struct({ value: Schema.String }) })
      .pipe(Effect.provideService(ResponseFormat, format))
    assert.strictEqual(seen[0], format)
    assert.notStrictEqual(seen[1], format)
    assert.strictEqual(seen[1]?.type, "json")
    assert.deepStrictEqual(result.value, { value: "ok" })
    const invalid = yield* Effect.result(
      model.generateObject({ prompt: "invalid", schema: Schema.Struct({ value: Schema.Number }) }).pipe(
        Effect.provideService(ResponseFormat, format)
      )
    )
    assert.strictEqual(invalid._tag, "Failure")
  }))

it.effect("keeps managed and deferred validation isolated without executing deferred calls", () =>
  Effect.gen(function*() {
    const executed: Array<string> = []
    const toolkit = Toolkit.make(
      Tool.make("read", {
        parameters: Schema.Struct({ path: Schema.String }),
        success: Schema.String,
        failureMode: "return"
      })
    )
    const handlers = toolkit.toLayer({
      read: (params) =>
        Effect.sync(() => {
          executed.push(params.path)
          return "ok"
        })
    })
    const model = yield* make({
      generateText: () => Effect.succeed([]),
      streamText: () =>
        Stream.fromIterable(
          ["a", "b", "c"].map((id) =>
            ({ type: "tool-call", id, name: "read", params: { path: id === "b" ? 123 : id } }) as const
          )
        ).pipe(Stream.tap(() => Effect.yieldNow))
    })
    const [deferred, managed] = yield* Effect.all([
      model.streamText({ prompt: "deferred", toolkit, disableToolCallResolution: true }).pipe(Stream.runCollect),
      model.streamText({ prompt: "managed", toolkit }).pipe(Stream.runCollect)
    ], { concurrency: "unbounded" }).pipe(Effect.provide(handlers))
    assert.deepStrictEqual(executed.sort(), ["a", "c"])
    assert.deepStrictEqual(deferred.filter((part) => part.type === "tool-call").map((part) => part.id), ["a", "c"])
    assert.strictEqual(deferred.filter((part) => part.type === "error").length, 1)
    assert.strictEqual(deferred.filter((part) => part.type === "tool-result").length, 0)
    assert.strictEqual(managed.filter((part) => part.type === "error").length, 0)
    assert.deepStrictEqual(
      managed.filter((part) => part.type === "tool-result").map((part) => [part.id, part.isFailure]).sort(),
      [["a", false], ["b", true], ["c", false]]
    )
  }))
