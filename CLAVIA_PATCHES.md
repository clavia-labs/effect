# Clavia provider patches

Base: upstream `effect@4.1.2` (`506eef143b`). Packages use the `@tardie` scope and require the upstream `effect@4.1.2` runtime. [CLAVIA_PUBLISHING.md](CLAVIA_PUBLISHING.md) describes package checks and publication.

The fork adds two packages, `@tardie/ai` and `@tardie/ai-bedrock`, and patches the four upstream providers. Each patch below states the behavior, the reason, and the test that proves it.

## Shared package

### Scoped response formats

`@tardie/ai/LanguageModel` exports `ResponseFormat` and `make`. `make` calls upstream `LanguageModel.make` and, when a request uses the text format, substitutes the `ResponseFormat` provided in the current context. Object generation keeps its own schema and decoding. Upstream `streamText` always requests `{ type: "text" }`, so streamed generation with tools has no native structured output without this service. All five providers construct through this `make`.

`packages/ai/clavia/test/LanguageModel.test.ts` covers concurrent format isolation and object schema precedence; `ProviderStreams.test.ts` checks each provider's native format field.

### Tool-result file placement

`@tardie/ai/ToolResult` exports `prepare(prompt, supports)`. It moves files in a tool result's `modelOutput` that the provider cannot carry inline into a user message after the tool-result batch, labelled with the tool name and call ID. Chat-completion APIs accept only text in tool messages; upstream replaces such files with `[mediaType omitted]` text. openai-compat and OpenRouter call `prepare(prompt, () => false)`; Bedrock keeps images inline for Claude and Nova models.

`ProviderStreams.test.ts` multipart cases and `packages/ai/bedrock/test/ToolContent.test.ts` cover placement.

## Provider patches

| Patch                      | Providers                             | Behavior                                                                                                                                                                                                                                                       | Test                                                                                                                        |
| -------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Deferred tool parse errors | OpenAI, Anthropic, compat, OpenRouter | A tool call whose arguments do not parse closes without a `tool-call` part; the error is dropped on a `length` finish and otherwise raised after the finish part, so usage is recorded                                                                         | `ProviderStreams` malformed-JSON and partial-length cases; Anthropic `handles malformed streamed ... JSON with stop reason` |
| Function call signatures   | OpenAI                                | `function_call` items carry `encrypted_content`; streamed calls are emitted on item completion and flushed at terminal events in output order; replay sends `encrypted_content` back                                                                           | `ProviderStreams` encrypted-content cases; OpenAI `stateless reasoning replay`                                              |
| Streamed request files     | OpenAI                                | With `streamFiles`, inline image and PDF bytes stream into the request body in `requestBodyChunkBytes` chunks (`DEFAULT_REQUEST_BODY_CHUNK_BYTES`, 48 KiB); `fileUrlToStream(url, mediaType)` resolves selected file URLs to bytes read while the body is sent | `packages/ai/openai/test/StreamingRequest.test.ts`                                                                          |
| Completion evidence        | compat                                | `[DONE]` without a prior `finish_reason` fails with a retryable `NetworkError`                                                                                                                                                                                 | compat `rejects a sentinel without provider completion`                                                                     |
| Choice guard               | compat                                | `n` other than 1 fails before transport with `InvalidRequestError`; a streamed choice index other than 0 fails with `InvalidResponseError`                                                                                                                     | `ProviderStreams` choice cases                                                                                              |
| Reasoning usage            | Anthropic                             | `output_tokens_details.thinking_tokens` maps to `outputTokens.reasoning`; a later `message_delta` without the detail keeps the earlier count                                                                                                                   | Anthropic `thinking` suite                                                                                                  |
| Routed provider identity   | OpenRouter                            | The stream chunk schema keeps `provider`, and the finish metadata reports the last value seen                                                                                                                                                                  | `ProviderStreams` OpenRouter usage case                                                                                     |
| Configuration schemas      | all four                              | Each language-model module exports `ConfigSchema` and `ModelConfigSchema`; `Config` is `typeof ConfigSchema.Encoded`. Anthropic `output_config.effort` uses the generated effort levels, including `xhigh` and `max`                                           | `packages/ai/clavia/test/ConfigSchema.test.ts`, `ConfigSchema.types.ts`                                                     |

Upstream tests that assert the replaced behavior are changed in place: the Anthropic malformed streamed JSON test covers both stop reasons, and the compat and OpenRouter `sends tool result model output` cases expect files to move out of the tool message.

## Bedrock provider

`packages/ai/bedrock` supplies `@tardie/ai-bedrock`, an AWS Converse streaming provider. AWS owns event-stream decoding; the provider maps prompts, tools, signed and redacted reasoning, token usage, cancellation, and errors. `generateText` fails with a typed unsupported-operation error.

Requests with no active tools reject native tool history before transport. `toolHistory: "text"` converts historical calls and results into escaped `<tool_call>` and `<tool_result>` text blocks and adds a system instruction treating them as data. HTTP error evidence keeps the status, allowlisted diagnostic headers, the SDK request ID, and recognized plaintext error codes, without response content, cookies, or authorization headers. Local request validation emits `InvalidUserInputError`; AWS exception names are kept as `reason.metadata.bedrock.errorType`.

`packages/ai/bedrock/test/BedrockLanguageModel.test.ts` covers history policies, reasoning replay, deferred tool validation, fragmented and corrupted frames, cancellation, error classification, and usage.

## Validation

```sh
pnpm lint
pnpm check
pnpm jsdocs --check
pnpm test --run packages/ai/clavia/test packages/ai/openai/test packages/ai/anthropic/test packages/ai/openai-compat/test packages/ai/openrouter/test packages/ai/bedrock/test
```
