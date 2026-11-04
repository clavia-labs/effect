/**
 * Tool-result file placement shared by provider adapters.
 * @stability unstable
 * @since 0.0.5
 */
import * as Prompt from "effect/ai/Prompt"

/**
 * prepare keeps supported files in tool results and moves remaining files after the tool-result batch.
 * @stability unstable
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
      if (part.type !== "tool-result" || part.modelOutput === undefined) return part
      const files = part.modelOutput.filter((item) => item.type === "file" && !supports(item))
      if (files.length === 0) return part
      attachments.push(
        Prompt.textPart({ text: `Attached media from tool ${part.name} (call ${part.id}):` }),
        ...files
      )
      return Prompt.toolResultPart({
        ...part,
        modelOutput: part.modelOutput.filter((item) => !files.includes(item))
      })
    })
    messages.push(Prompt.makeMessage("tool", { ...message, content }))
    if (prompt.content[index + 1]?.role !== "tool" && attachments.length > 0) {
      messages.push(Prompt.makeMessage("user", { content: attachments.splice(0) }))
    }
  }
  return Prompt.fromMessages(messages)
}
