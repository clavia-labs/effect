# Clavia AI

This package supplies a shared factory for Clavia provider packages. It uses the upstream Effect runtime.

`make` accepts the same provider hooks as `LanguageModel.make`. `ResponseFormat` supplies a request format through Effect context. Without this service, text generation uses the native text format. Object generation keeps its own schema and decoding.

```ts
import { ResponseFormat } from "@clavia/ai/LanguageModel"
import { Schema, Stream } from "effect"
import { LanguageModel } from "effect/unstable/ai"

const response = LanguageModel.streamText({ prompt: "Return an answer." }).pipe(
  Stream.provideService(ResponseFormat, {
    type: "json",
    objectName: "answer",
    schema: Schema.Struct({ answer: Schema.String })
  })
)
```

Supply a Clavia provider layer when running the stream. The format constrains the provider request. It does not validate the returned text as an object.

When `disableToolCallResolution` is true, return-mode tool calls are checked with Effect's encoded parameter schemas. An invalid call becomes an identified `ToolCallValidationError` response part. Valid calls continue without executing handlers. Default-mode validation failures retain upstream behavior. This handling applies to streaming responses.
