import type { ConverseStreamCommandInput, ConverseStreamOutput } from "@aws-sdk/client-bedrock-runtime"
import { ResponseFormat } from "@tardie/ai"
import { BedrockLanguageModel } from "@tardie/ai-bedrock"
import { Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { LanguageModel, Prompt, Tool, Toolkit } from "effect/unstable/ai"
import { FetchHttpClient } from "effect/unstable/http"
import { crc32 } from "node:zlib"
import { expect, test } from "vitest"

const collectResponse = <Tools extends Record<string, Tool.Any>>(
  prompt: Prompt.RawInput,
  toolkit: Toolkit.Toolkit<Tools>,
  _observer?: undefined,
  responseFormat?: LanguageModel.ProviderOptions["responseFormat"]
) =>
  LanguageModel.streamText({ prompt, toolkit, disableToolCallResolution: true }).pipe(
    (stream) => responseFormat === undefined ? stream : Stream.provideService(stream, ResponseFormat, responseFormat),
    Stream.runCollect,
    Effect.flatMap((parts) =>
      Schema.encodeEffect(Prompt.Prompt)(Prompt.fromResponseParts(parts)).pipe(
        Effect.map((continuation) => ({ parts, continuation }))
      )
    )
  )

const events = (truncated = false): Array<ConverseStreamOutput> => [
  { messageStart: { role: "assistant" } },
  { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: "Check" } } } },
  { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: "signed" } } } },
  { contentBlockStop: { contentBlockIndex: 0 } },
  {
    contentBlockDelta: {
      contentBlockIndex: 1,
      delta: { reasoningContent: { redactedContent: new Uint8Array([1, 2, 3]) } }
    }
  },
  { contentBlockStop: { contentBlockIndex: 1 } },
  ...["a", "b", "c"].flatMap((id, index): Array<ConverseStreamOutput> => [
    { contentBlockStart: { contentBlockIndex: index + 2, start: { toolUse: { toolUseId: id, name: "read" } } } },
    {
      contentBlockDelta: {
        contentBlockIndex: index + 2,
        delta: { toolUse: { input: truncated ? "{\"path\":" : JSON.stringify({ path: id === "b" ? 123 : id }) } }
      }
    },
    { contentBlockStop: { contentBlockIndex: index + 2 } }
  ]),
  { messageStop: { stopReason: truncated ? "max_tokens" : "tool_use" } },
  { metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, metrics: { latencyMs: 1 } } }
]
const toolkit = Toolkit.make(
  Tool.make("read", { parameters: Schema.Struct({ path: Schema.String }), failureMode: "return" })
)

for (const mode of ["removed", "disabled", "enabled"] as const) {
  test(`Bedrock preserves historical tool data with tools ${mode}`, async () => {
    const prompt = Prompt.make([
      { role: "user", content: "Read the file" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Check the file", options: { bedrock: { signature: "signed" } } },
          { type: "tool-call", id: "call-1", name: "read", params: { path: "a" } }
        ]
      },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          id: "call-1",
          name: "read",
          result: { contents: "secret nonce" },
          isFailure: false
        }]
      },
      { role: "user", content: "Answer from the previous result" }
    ])
    const before = JSON.stringify(prompt)
    let sent: ConverseStreamCommandInput | undefined
    const layer = BedrockLanguageModel.layer({
      model: { model: "claude" },
      client: {
        send: async (input) => {
          sent = input
          return {
            $metadata: {},
            stream: (async function*() {
              yield { messageStop: { stopReason: "end_turn" as const } }
              yield {
                metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, metrics: { latencyMs: 1 } }
              }
            })()
          }
        }
      }
    })
    await Effect.runPromise(
      LanguageModel.streamText({
        prompt,
        toolkit: mode === "removed" ? Toolkit.empty : toolkit,
        toolChoice: mode === "disabled" ? "none" : "auto",
        disableToolCallResolution: true
      }).pipe(Stream.runCollect, Effect.provide(layer.pipe(Layer.provide(FetchHttpClient.layer))))
    )
    const parts = sent?.messages?.flatMap((message) => message.content ?? []) ?? []
    expect(parts.find((part) => part.reasoningContent)).toEqual({
      reasoningContent: { reasoningText: { text: "Check the file", signature: "signed" } }
    })
    const expected = [
      { toolUse: { toolUseId: "call-1", name: "read", input: { path: "a" } } },
      {
        toolResult: {
          toolUseId: "call-1",
          status: "success" as const,
          content: [{ text: "{\"contents\":\"secret nonce\"}" }]
        }
      }
    ]
    if (mode === "enabled") {
      expect(sent?.toolConfig?.tools).toHaveLength(1)
      expect(parts.filter((part) => part.toolUse || part.toolResult)).toEqual(expected)
    } else {
      expect(sent?.toolConfig).toBeUndefined()
      expect(parts.some((part) => part.toolUse || part.toolResult)).toBe(false)
      expect(parts.flatMap((part) => part.text?.startsWith("{\"tool") ? [JSON.parse(part.text)] : [])).toEqual(expected)
    }
    expect(JSON.stringify(prompt)).toBe(before)
  })
}

for (const input of [undefined, "", "{}", "{"] as const) {
  test(`Bedrock validates tool arguments when input is ${JSON.stringify(input)}`, async () => {
    const selected = Toolkit.make(
      Tool.make("empty", { parameters: Schema.Struct({}), failureMode: "return" }),
      Tool.make("read", { parameters: Schema.Struct({ path: Schema.String }), failureMode: "return" })
    )
    const layer = BedrockLanguageModel.layer({
      model: { model: "claude" },
      client: {
        send: async () => ({
          $metadata: {},
          stream: (async function*() {
            for (const [index, name] of ["empty", "read"].entries()) {
              yield { contentBlockStart: { contentBlockIndex: index, start: { toolUse: { toolUseId: name, name } } } }
              if (input !== undefined) {
                yield { contentBlockDelta: { contentBlockIndex: index, delta: { toolUse: { input } } } }
              }
              yield { contentBlockStop: { contentBlockIndex: index } }
            }
            yield { messageStop: { stopReason: "tool_use" as const } }
            yield {
              metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, metrics: { latencyMs: 1 } }
            }
          })()
        })
      }
    })
    const outcome = await Effect.runPromise(
      collectResponse("Read", selected).pipe(
        Effect.provide(layer.pipe(Layer.provide(FetchHttpClient.layer))),
        Effect.result
      )
    )
    if (input === "{") {
      expect(outcome._tag).toBe("Failure")
      return
    }
    if (outcome._tag === "Failure") throw outcome.failure
    expect(outcome.success.parts.filter((part) => part.type === "tool-call")).toMatchObject([{
      id: "empty",
      params: {}
    }])
    expect(outcome.success.parts.find((part) => part.type === "error")?.error).toMatchObject({
      _tag: "ToolCallValidationError",
      id: "read"
    })
  })
}

test("Bedrock preserves complete tool calls when output reaches its token limit", async () => {
  const bash = Toolkit.make(
    Tool.make("bash", { parameters: Schema.Struct({ command: Schema.String }), failureMode: "return" })
  )
  const inputs = [
    { id: "complete", input: "{\"command\":\"pwd\"}" },
    { id: "partial", input: "{\"command\":" },
    { id: "unsafe", input: "{\"__proto__\":{}}" },
    { id: "empty", input: "" }
  ]
  const layer = BedrockLanguageModel.layer({
    model: { model: "claude" },
    client: {
      send: async () => ({
        $metadata: {},
        stream: (async function*() {
          for (const [index, call] of inputs.entries()) {
            yield {
              contentBlockStart: {
                contentBlockIndex: index,
                start: { toolUse: { toolUseId: call.id, name: "bash" } }
              }
            }
            if (call.input !== "") {
              yield { contentBlockDelta: { contentBlockIndex: index, delta: { toolUse: { input: call.input } } } }
            }
            yield { contentBlockStop: { contentBlockIndex: index } }
          }
          yield { messageStop: { stopReason: "max_tokens" as const } }
          yield {
            metadata: { usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 }, metrics: { latencyMs: 1 } }
          }
        })()
      })
    }
  })
  const parts = await Effect.runPromise(
    LanguageModel.streamText({
      prompt: "Run pwd",
      toolkit: bash,
      disableToolCallResolution: true
    }).pipe(Stream.runCollect, Effect.provide(layer.pipe(Layer.provide(FetchHttpClient.layer))))
  )
  expect(parts.filter((part) => part.type === "tool-call")).toMatchObject([{
    id: "complete",
    name: "bash",
    params: { command: "pwd" }
  }])
  expect(parts.find((part) => part.type === "finish")).toMatchObject({
    reason: "length",
    usage: { inputTokens: { total: 10 }, outputTokens: { total: 4 } },
    metadata: { bedrock: { usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } } }
  })
})

for (const interleaved of [false, true]) {
  test(`Bedrock preserves signed and redacted reasoning beside rejected calls (interleaved: ${interleaved})`, async () => {
    const inputs: Array<ConverseStreamCommandInput> = []
    const signals: Array<AbortSignal> = []
    const layer = BedrockLanguageModel.layer({
      model: {
        model: "claude",
        config: { additionalModelRequestFields: { thinking: { type: "enabled", budget_tokens: 1024 } } }
      },
      client: {
        send: async (input, signal) => {
          inputs.push(input)
          signals.push(signal)
          const all = events()
          const tools = all.slice(6, -2)
          return {
            $metadata: {},
            stream: (async function*() {
              yield* interleaved
                ? [
                  ...all.slice(0, 6),
                  ...tools.filter((event) => event.contentBlockStop === undefined),
                  ...tools.filter((event) => event.contentBlockStop !== undefined).reverse(),
                  ...all.slice(-2)
                ]
                : all
            })()
          }
        }
      }
    })
    const run = (prompt: Prompt.RawInput) =>
      Effect.runPromise(
        collectResponse(prompt, toolkit, undefined, {
          type: "json",
          objectName: "answer",
          schema: Schema.Struct({ answer: Schema.String })
        }).pipe(Effect.provide(layer.pipe(Layer.provide(FetchHttpClient.layer))))
      )
    const first = await run("Read")
    expect(first.parts.filter((part) => part.type === "tool-call").map((part) => part.id)).toEqual(["a", "c"])
    expect(first.parts.find((part) => part.type === "error")?.error).toMatchObject({
      _tag: "ToolCallValidationError",
      id: "b"
    })
    expect(first.parts.find((part) => part.type === "finish")).toMatchObject({
      usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } }
    })
    const restored = Schema.decodeUnknownSync(Prompt.Prompt)(JSON.parse(JSON.stringify(first.continuation)))
    await run(
      Prompt.concat(
        restored,
        Prompt.make([{
          role: "tool",
          content: ["a", "c"].map((id) => ({
            type: "tool-result" as const,
            id,
            name: "read",
            result: "contents",
            isFailure: false
          }))
        }])
      )
    )
    expect(inputs[1]?.messages?.find((message) => message.role === "assistant")?.content).toMatchObject([
      { reasoningContent: { reasoningText: { text: "Check", signature: "signed" } } },
      { reasoningContent: { redactedContent: new Uint8Array([1, 2, 3]) } },
      ...["a", "c"].map((id) => ({ toolUse: { toolUseId: id } }))
    ])
    expect(inputs[1]?.messages?.at(-1)?.content?.[1]).toMatchObject({
      toolResult: { toolUseId: "c", status: "success" }
    })
    expect(inputs[0]).toMatchObject({
      additionalModelRequestFields: { thinking: { type: "enabled", budget_tokens: 1024 } },
      outputConfig: { textFormat: { type: "json_schema" } }
    })
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })
}

test("Bedrock cancellation aborts a request after its response headers arrive", async () => {
  let aborted = false
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const started = yield* Deferred.make<void>()
    const layer = BedrockLanguageModel.layer({
      model: { model: "claude" },
      client: {
        send: async (_input, signal) => ({
          $metadata: {},
          stream: (async function*() {
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => {
                aborted = true
                resolve()
              }, { once: true })
              Deferred.doneUnsafe(started, Effect.void)
            })
            yield { messageStart: { role: "assistant" as const } }
          })()
        })
      }
    })
    const fiber = yield* Effect.forkChild(
      collectResponse("Read", toolkit).pipe(Effect.provide(layer.pipe(Layer.provide(FetchHttpClient.layer))))
    )
    yield* Deferred.await(started)
    yield* Fiber.interrupt(fiber)
  })))
  expect(aborted).toBe(true)
})

const awsFrame = (event: ConverseStreamOutput): Uint8Array => {
  const [name, value] = Object.entries(event)[0]!
  const encoder = new TextEncoder()
  const headers = new Uint8Array(
    [[":message-type", "event"], [":event-type", name], [":content-type", "application/json"]].flatMap(
      ([key, value]) => {
        const k = encoder.encode(key)
        const v = encoder.encode(value)
        return [k.length, ...k, 7, v.length >> 8, v.length & 255, ...v]
      }
    )
  )
  const body = encoder.encode(JSON.stringify(value))
  const bytes = new Uint8Array(16 + headers.length + body.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.length)
  view.setUint32(4, headers.length)
  view.setUint32(8, crc32(bytes.subarray(0, 8)))
  bytes.set(headers, 12)
  bytes.set(body, 12 + headers.length)
  view.setUint32(bytes.length - 4, crc32(bytes.subarray(0, bytes.length - 4)))
  return bytes
}

for (const corruption of ["none", "checksum", "truncated"] as const) {
  test(`Bedrock AWS transport handles ${corruption} binary frames`, async () => {
    let requests = 0
    const layer = BedrockLanguageModel.layer({
      model: { model: "claude" },
      client: {
        region: "us-east-1",
        endpoint: "https://fixture.invalid",
        token: { token: "test-token" },
        authSchemePreference: ["httpBearerAuth"],
        requestHandler: {
          handle: async (request: { path: string; headers: Record<string, string>; body?: unknown }) => {
            requests++
            expect(request.path).toBe("/model/claude/converse-stream")
            expect(new Headers(request.headers).get("authorization")).toBe("Bearer test-token")
            expect(
              JSON.parse(
                request.body instanceof Uint8Array ? new TextDecoder().decode(request.body) : String(request.body)
              )
            ).toMatchObject({
              messages: [{ role: "user", content: [{ text: "Read" }] }],
              toolConfig: { tools: [{ toolSpec: { name: "read" } }] }
            })
            const wireEvents = events().filter((event) =>
              event.contentBlockDelta?.delta?.reasoningContent?.redactedContent === undefined &&
              event.contentBlockStop?.contentBlockIndex !== 1
            )
            return {
              response: {
                statusCode: 200,
                headers: { "content-type": "application/vnd.amazon.eventstream" },
                body: (async function*() {
                  for (const event of wireEvents) {
                    const frame = awsFrame(event)
                    if (corruption === "checksum") frame[frame.length - 1] = frame[frame.length - 1]! ^ 1
                    yield frame.subarray(0, 5)
                    yield frame.subarray(5, corruption === "truncated" ? frame.length - 1 : frame.length)
                    if (corruption !== "none") return
                  }
                })()
              }
            }
          }
        }
      }
    })
    const outcome = await Effect.runPromise(
      collectResponse("Read", toolkit).pipe(
        Effect.provide(layer.pipe(Layer.provide(FetchHttpClient.layer))),
        Effect.result
      )
    )
    expect(requests).toBe(1)
    if (corruption !== "none") {
      expect(outcome._tag).toBe("Failure")
      return
    }
    if (outcome._tag === "Failure") throw outcome.failure
    const result = outcome.success
    expect(result.parts.filter((part) => part.type === "tool-call").map((part) => part.id)).toEqual(["a", "c"])
    expect(result.parts.find((part) => part.type === "error")?.error).toMatchObject({ id: "b" })
  })
}

for (const mode of ["default-validation", "provider-validation", "throttle"] as const) {
  test(`Bedrock handles ${mode} without executing a partial batch`, async () => {
    let requests = 0
    const layer = BedrockLanguageModel.layer({
      model: { model: "claude" },
      client: {
        send: async () => {
          requests++
          if (mode === "throttle") {
            const error = new Error("slow down")
            error.name = "ThrottlingException"
            throw error
          }
          if (mode === "provider-validation") {
            const event: ConverseStreamOutput = {
              validationException: {
                name: "ValidationException",
                $fault: "client",
                $metadata: {},
                message: "invalid request"
              }
            }
            return {
              $metadata: {},
              stream: (async function*() {
                yield event
              })()
            }
          }
          return {
            $metadata: {},
            stream: (async function*() {
              yield* events()
            })()
          }
        }
      }
    })
    const selected = Toolkit.make(
      Tool.make("read", {
        parameters: Schema.Struct({ path: Schema.String }),
        failureMode: mode === "default-validation" ? "error" : "return"
      })
    )
    const outcome = await Effect.runPromise(
      collectResponse("Read", selected).pipe(
        Effect.provide(layer.pipe(Layer.provide(FetchHttpClient.layer))),
        Effect.result
      )
    )
    expect(requests).toBe(1)
    expect(outcome._tag).toBe("Failure")
    if (outcome._tag === "Failure") {
      expect(outcome.failure).toMatchObject({
        reason: {
          _tag: mode === "throttle"
            ? "RateLimitError"
            : mode === "provider-validation"
            ? "InvalidRequestError"
            : "InvalidOutputError"
        }
      })
    }
  })
}

test("Bedrock exposes the stream-only contract", async () => {
  const layer = BedrockLanguageModel.layer({
    model: { model: "claude" },
    client: {
      send: async () => {
        throw new Error("must not send")
      }
    }
  })
  const result = await Effect.runPromise(
    LanguageModel.generateText({ prompt: "Hello" }).pipe(Effect.provide(layer), Effect.result)
  )
  expect(result._tag).toBe("Failure")
  if (result._tag === "Failure") expect(result.failure).toMatchObject({ reason: { _tag: "InvalidRequestError" } })
})

test("Bedrock preserves reported cache buckets and raw usage", async () => {
  const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadInputTokens: 3, cacheWriteInputTokens: 2 }
  const layer = BedrockLanguageModel.layer({
    model: { model: "claude" },
    client: {
      send: async () => ({
        $metadata: {},
        stream: (async function*() {
          yield { messageStop: { stopReason: "end_turn" as const } }
          yield { metadata: { usage, metrics: { latencyMs: 1 } } }
        })()
      })
    }
  })
  const parts = await Effect.runPromise(
    LanguageModel.streamText({ prompt: "Read" }).pipe(Stream.runCollect, Effect.provide(layer))
  )
  expect(parts.find((part) => part.type === "finish")).toMatchObject({
    usage: { inputTokens: { total: 15, uncached: 10, cacheRead: 3, cacheWrite: 2 }, outputTokens: { total: 5 } },
    metadata: { bedrock: { usage } }
  })
})
