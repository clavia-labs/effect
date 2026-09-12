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
