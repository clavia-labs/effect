import type { ConverseStreamCommandInput, ConverseStreamOutput } from "@aws-sdk/client-bedrock-runtime"
import { BedrockLanguageModel } from "@tardie/ai-bedrock"
import { Effect, Layer, Schema, Stream } from "effect"
import { LanguageModel, Prompt, Tool, Toolkit } from "effect/unstable/ai"
import { FetchHttpClient } from "effect/unstable/http"
import { expect, test } from "vitest"

test("Bedrock maps native historical names and restores colliding active tool names", async () => {
  const names = ["packages.skill", "packages_skill", "packages/skill", "x".repeat(65), "検索", ""]
  const toolkit = Toolkit.make(...names.map((name) => Tool.make(name, { parameters: Schema.Struct({}) })))
  const prompt = Prompt.make([
    { role: "user", content: "Search" },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "Inspect", options: { bedrock: { signature: "signed" } } },
        { type: "tool-call", id: "old-1", name: "removed.tool", params: {} },
        { type: "tool-call", id: "old-2", name: "packages.skill", params: {} }
      ]
    },
    {
      role: "tool",
      content: [
        { type: "tool-result", id: "old-1", name: "removed.tool", result: "found", isFailure: false },
        { type: "tool-result", id: "old-2", name: "packages.skill", result: "found", isFailure: false }
      ]
    }
  ])
  const before = JSON.stringify(prompt)
  let sent: ConverseStreamCommandInput | undefined
  const layer = BedrockLanguageModel.layer({
    model: { model: "claude", config: { toolHistory: "text" } },
    client: {
      send: async (input) => {
        sent = input
        return {
          $metadata: {},
          stream: (async function*(): AsyncGenerator<ConverseStreamOutput> {
            for (const [index, tool] of (input.toolConfig?.tools ?? []).entries()) {
              yield {
                contentBlockStart: {
                  contentBlockIndex: index,
                  start: { toolUse: { toolUseId: `new-${index}`, name: tool.toolSpec!.name } }
                }
              }
              yield { contentBlockDelta: { contentBlockIndex: index, delta: { toolUse: { input: "{}" } } } }
              yield { contentBlockStop: { contentBlockIndex: index } }
            }
            yield { messageStop: { stopReason: "tool_use" } }
            yield {
              metadata: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, metrics: { latencyMs: 1 } }
            }
          })()
        }
      }
    }
  })
  const parts = await Effect.runPromise(
    LanguageModel.streamText({
      prompt,
      toolkit,
      toolChoice: { tool: "packages.skill" },
      disableToolCallResolution: true
    }).pipe(Stream.runCollect, Effect.provide(layer.pipe(Layer.provide(FetchHttpClient.layer))))
  )
  const wireNames = sent!.toolConfig!.tools!.map((tool) => tool.toolSpec!.name)
  const content = sent!.messages!.flatMap((message) => message.content ?? [])
  const history = content.flatMap((part) => part.toolUse === undefined ? [] : [part.toolUse])
  for (const name of [...wireNames, ...history.map((call) => call.name)]) {
    expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
  }
  expect(new Set(wireNames).size).toBe(names.length)
  expect(wireNames[1]).toBe("packages_skill")
  expect(history[0]!.toolUseId).toBe("old-1")
  expect(history[1]).toMatchObject({ toolUseId: "old-2", name: wireNames[0] })
  expect(wireNames).not.toContain(history[0]!.name)
  expect(sent!.toolConfig!.toolChoice).toEqual({ tool: { name: wireNames[0] } })
  expect(content.filter((part) => part.toolResult !== undefined)).toHaveLength(2)
  expect(content).toContainEqual({ reasoningContent: { reasoningText: { text: "Inspect", signature: "signed" } } })
  expect(parts.filter((part) => part.type === "tool-params-start").map((part) => part.name)).toEqual(names)
  expect(parts.filter((part) => part.type === "tool-call").map((part) => part.name)).toEqual(names)
  expect(JSON.stringify(prompt)).toBe(before)
})
