# Clavia provider patches

Base: `effect@4.0.0-rc.110`. Branch: `clavia/ai-providers`.

This fork carries provider changes for Tardigrade. The Effect runtime source is unchanged. The provider packages use the `@clavia` scope. `@clavia/ai` supplies their shared factory wrapper.

## Ported changes

| Change                      | Packages                             | Contract                                                                                                                                         |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recoverable tool validation | OpenAI, Anthropic, OpenAI compatible | Return-mode tools emit identified validation errors. Later calls and usage remain available. Default-mode tools still fail.                      |
| Dynamic parameter decoding  | All three                            | Preserve the existing dynamic-tool schema bypass during this source port. Review its removal with native schema construction separately.         |
| Output limit handling       | All three                            | Preserve length completion and usage. OpenAI and Anthropic defer tool JSON parse errors until completion; normal malformed responses still fail. |
| Raw usage                   | OpenAI, OpenAI compatible            | Preserve provider usage fields in finish metadata.                                                                                               |
| Completion evidence         | OpenAI compatible                    | Reject a final sentinel without a provider finish reason.                                                                                        |
| Reasoning replay            | OpenAI compatible                    | Preserve the observed reasoning field and combine assistant reasoning, text, and calls during replay.                                            |
| Shared metadata types       | OpenAI compatible                    | Align approval metadata with the OpenAI provider declarations.                                                                                   |

## Response format wrapper

`@clavia/ai/LanguageModel` exports `ResponseFormat` and `make`. The factory calls upstream `LanguageModel.make` with wrapped provider hooks. A scoped `ResponseFormat` supplies the text-generation format. Object generation retains its explicit schema and native decoding.

All three provider factories use this wrapper. Effect service identity, prompt handling, and validation remain upstream. The wrapper does not replace or patch the Effect module.

## Validation

Run `pnpm test --run packages/ai/clavia/test/LanguageModel.test.ts packages/ai/clavia/test/ProviderStreams.test.ts packages/ai/openai/test/OpenAiLanguageModel.test.ts packages/ai/anthropic/test/AnthropicLanguageModel.test.ts packages/ai/openai-compat/test/OpenAiLanguageModel.test.ts`.

Run `pnpm lint-fix` and `pnpm check`.

The shared provider suite covers mixed valid and invalid calls, segmented SSE, default validation failures, output-limit completion, malformed JSON, raw usage, native response formats, and reasoning replay after JSON restoration. The OpenAI fixture exercises both argument completion and item completion to catch duplicate calls.

The wrapper suite covers concurrent format isolation, text generation, and object schema precedence with native decoding. The compatible-provider suite covers successful completion and rejection of a bare sentinel.

Durable event recording, retry policy, host lifecycle, and tool dispatch remain Tardigrade tests. Live provider requests are outside these fixture tests.

## Publication

[CLAVIA_PUBLISHING.md](CLAVIA_PUBLISHING.md) describes package checks, npm authentication, and the GitHub publishing workflow.

Generated JavaScript and declarations come from the fork build. Dependency patch files and generated distribution files are not copied into the source tree.
