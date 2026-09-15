# Bedrock for Effect AI

`@tardie/ai-bedrock` supplies Effect LanguageModel through AWS Bedrock Converse streaming. It requires `effect@4.0.0-rc.115`.

```ts
import { BedrockLanguageModel } from "@tardie/ai-bedrock"
import { Effect, Stream } from "effect"
import { LanguageModel } from "effect/unstable/ai"

const model = BedrockLanguageModel.layer({
  client: { region: "us-east-1" },
  model: { model: "your-bedrock-model-id" }
})

const parts = await Effect.runPromise(
  LanguageModel.streamText({ prompt: "Hello" }).pipe(
    Stream.runCollect,
    Effect.provide(model)
  )
)
```

The client accepts AWS SDK configuration or an injected `send(input, signal)` transport. `BedrockLanguageModel.Config` supplies scoped Converse request options. Signed and redacted reasoning is carried in Effect prompt options.

This package supports text, reasoning, and function tools through `streamText`. `generateText`, provider-defined tools, and other prompt part types fail explicitly. The AWS SDK client makes one attempt per request; the caller owns retries.

Set `model.config.toolHistory` to `"text"` to support a final answer without tools after earlier tool use. The adapter converts historical calls and results into tagged text and omits historical reasoning from that request. IDs, arguments, results, and failure status remain in the text. The original Prompt stays unchanged. With active tools, history remains native. The default `"native"` policy rejects tool history when no tools are enabled.

The adapter maps tool names to the Bedrock name format for each request. It applies the same mapping to tool definitions, native history, and forced tool choices, then restores original names in streamed responses. Valid names stay unchanged. Names that need conversion receive unique names of at most 64 characters. Call IDs and the input prompt stay unchanged.
