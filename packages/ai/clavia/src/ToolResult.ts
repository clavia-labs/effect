/**
 * Multipart tool results shared by provider adapters.
 * @since 0.0.5
 */
import * as Schema from "effect/Schema"
import * as Prompt from "effect/unstable/ai/Prompt"

/**
 * Content identifies model-facing text and files without changing ordinary JSON results.
 * @since 0.0.5
 */
export const Content = Schema.Struct({
  type: Schema.Literal("content"),
  value: Schema.Array(Schema.Union([Prompt.TextPart, Prompt.FilePart]))
})

/**
 * Content is a multipart tool result.
 * @since 0.0.5
 */
export type Content = typeof Content.Type

/**
 * isContent distinguishes multipart output from ordinary tool values.
 * @since 0.0.5
 */
export const isContent = Schema.is(Content)

/**
 * text retains text parts in their original order for text-only tool transports.
 * @since 0.0.5
 */
export const text = (result: unknown): string =>
  isContent(result)
    ? result.value.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n")
    : typeof result === "string"
    ? result
    : JSON.stringify(result)

/**
 * prepare keeps supported files in tool results and moves remaining files after the tool-result batch.
 * @since 0.0.5
 */
export const prepare = (
  prompt: Prompt.Prompt,
  supports: (file: Prompt.FilePart) => boolean
): Prompt.Prompt => {
  const messages: Array<Prompt.Message> = []
  const attachments: Array<Prompt.UserMessagePart> = []
  for (let index = 0; index < prompt.content.length; index++) {
    const message = prompt.content[index]
    if (message.role !== "tool") {
      messages.push(message)
      continue
    }
    const content = message.content.map((part) => {
      if (part.type !== "tool-result" || !isContent(part.result)) return part
      const files = part.result.value.filter((item) => item.type === "file" && !supports(item))
      if (files.length === 0) return part
      attachments.push(
        Prompt.textPart({ text: `Attached media from tool ${part.name} (call ${part.id}):` }),
        ...files
      )
      return Prompt.toolResultPart({
        ...part,
        result: { type: "content", value: part.result.value.filter((item) => !files.includes(item)) }
      })
    })
    messages.push(Prompt.makeMessage("tool", { ...message, content }))
    if (prompt.content[index + 1]?.role !== "tool" && attachments.length > 0) {
      messages.push(Prompt.makeMessage("user", { content: attachments.splice(0) }))
    }
  }
  return Prompt.fromMessages(messages)
}
