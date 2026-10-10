import type { ConverseStreamCommandInput, ConverseStreamOutput } from "@aws-sdk/client-bedrock-runtime"
import { BedrockLanguageModel } from "@tardie/ai-bedrock"
import { Effect, Layer, Schema, Stream } from "effect"
import { LanguageModel, Prompt, Tool, Toolkit } from "effect/unstable/ai"
import { FetchHttpClient } from "effect/unstable/http"
import { expect, test } from "vitest"

for (const mode of ["native", "pdf", "text-history", "other-model"] as const) {
  test(`Bedrock carries tool files using ${mode}`, async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const file = Prompt.filePart({ mediaType: mode === "pdf" ? "application/pdf" : "image/png", data: bytes })
    const prompt = Prompt.make([
      { role: "assistant", content: [{ type: "tool-call", id: "capture", name: "read", params: { path: "a" } }] },
      {
        role: "tool",
        content: [{
          type: "tool-result",
          id: "capture",
          name: "read",
          result: {
            type: "content",
            value: [Prompt.textPart({ text: "Screenshot" }), file]
          },
          isFailure: false
        }]
      }
    ])
    const before = JSON.stringify(prompt)
    let sent: ConverseStreamCommandInput | undefined
    const layer = BedrockLanguageModel.layer({
      model: { model: mode === "other-model" ? "other" : "anthropic.claude", config: { toolHistory: "text" } },
      client: {
        send: async (input) => {
          sent = input
          return {
            $metadata: {},
            stream: (async function*(): AsyncGenerator<ConverseStreamOutput> {
              yield { messageStop: { stopReason: "end_turn" } }
              yield {
                metadata: { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 } }
              }
            })()
          }
        }
      }
    }).pipe(Layer.provide(FetchHttpClient.layer))
    await Effect.runPromise(
      LanguageModel.streamText({
        prompt,
        toolkit: Toolkit.make(Tool.make("read", { parameters: Schema.Struct({ path: Schema.String }) })),
        toolChoice: mode === "text-history" ? "none" : "auto",
        disableToolCallResolution: true
      }).pipe(Stream.runCollect, Effect.provide(layer))
    )
    expect(JSON.stringify(prompt)).toBe(before)
    const blocks = sent?.messages?.flatMap((message) => message.content ?? []) ?? []
    if (mode === "native") {
      expect(blocks).toContainEqual({
        toolResult: {
          toolUseId: "capture",
          status: "success",
          content: [
            { text: "Screenshot" },
            { image: { format: "png", source: { bytes } } }
          ]
        }
      })
      expect(blocks.some((block) => block.image !== undefined)).toBe(false)
    } else {
      const attachment = sent?.messages?.at(-1)
      expect(attachment?.role).toBe("user")
      expect(attachment?.content?.at(-2)).toEqual({ text: "Attached media from tool read (call capture):" })
      expect(attachment?.content?.at(-1)).toEqual(
        mode === "pdf"
          ? { document: { format: "pdf", name: "Tool attachment", source: { bytes } } }
          : { image: { format: "png", source: { bytes } } }
      )
      if (mode === "text-history") {
        expect(blocks).toContainEqual({
          text: "<tool_result id=\"capture\" status=\"success\">\nScreenshot\n</tool_result>"
        })
      } else {
        expect(blocks).toContainEqual({
          toolResult: { toolUseId: "capture", status: "success", content: [{ text: "Screenshot" }] }
        })
      }
    }
  })
}
