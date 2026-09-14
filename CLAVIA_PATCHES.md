# Clavia provider patches

Base: upstream `49e4b37b831a573567e0b67d3ec4593403dc2e72` (after `effect@4.0.0-rc.115`). Publishing branch: `clavia/ai-providers`.

The base includes OpenAI hosted-search failure preservation (#8157) and OpenRouter disjoint token usage accounting (#8170). The declaration fix (#8162) is upstream and no longer needs a fork commit.

This fork carries provider changes for Tardigrade. Consumers use upstream `effect@4.0.0-rc.115`, which includes declaration fix #8162. The provider packages use the `@tardie` scope. `@tardie/ai` supplies their shared factory wrapper.

## Ported changes

| Change                   | Packages                  | Contract                                                                                                                                                              |
| ------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deferred tool validation | Shared wrapper            | Effect encoded schemas check streamed calls before native response decoding. Return-mode failures remain identified errors; managed execution uses upstream behavior. |
| Output limit handling    | All three                 | Preserve length completion and usage. OpenAI and Anthropic defer tool JSON parse errors until completion; normal malformed responses still fail.                      |
| Raw usage                | OpenAI, OpenAI compatible | Preserve provider usage fields in finish metadata.                                                                                                                    |
| Completion evidence      | OpenAI compatible         | Reject a final sentinel without a provider finish reason.                                                                                                             |
| Reasoning replay         | OpenAI compatible         | Preserve the observed reasoning field and combine assistant reasoning, text, and calls during replay.                                                                 |
| Shared metadata types    | OpenAI compatible         | Align approval metadata with the OpenAI provider declarations.                                                                                                        |

## Response format wrapper

`@tardie/ai/LanguageModel` exports `ResponseFormat` and `make`. The factory calls upstream `LanguageModel.make` with wrapped provider hooks. A scoped `ResponseFormat` supplies the text-generation format. Object generation retains its explicit schema and native decoding.

All three provider factories use this wrapper. Effect service identity, prompt handling, and validation remain upstream. The wrapper does not replace or patch the Effect module. Its streamed deferred-call path checks encoded schemas before native response decoding. An internal context reference keeps that path separate from managed execution.

## Validation

Run `pnpm test --run packages/ai/clavia/test/LanguageModel.test.ts packages/ai/clavia/test/ProviderStreams.test.ts packages/ai/openai/test/OpenAiLanguageModel.test.ts packages/ai/anthropic/test/AnthropicLanguageModel.test.ts packages/ai/openai-compat/test/OpenAiLanguageModel.test.ts`.

Run `pnpm lint-fix` and `pnpm check`.

The shared provider suite covers mixed valid and invalid calls, segmented SSE, default validation failures, output-limit completion, malformed JSON, raw usage, native response formats, and reasoning replay after JSON restoration. The OpenAI fixture exercises both argument completion and item completion to catch duplicate calls.

The wrapper suite covers concurrent format isolation, text generation, and object schema precedence with native decoding. The compatible-provider suite covers successful completion and rejection of a bare sentinel.

Durable event recording, retry policy, host lifecycle, and tool dispatch remain Tardigrade tests. Live provider requests are outside these fixture tests.

## Publication

[CLAVIA_PUBLISHING.md](CLAVIA_PUBLISHING.md) describes package checks, npm authentication, and the GitHub publishing workflow.

Generated JavaScript and declarations come from the fork build. Dependency patch files and generated distribution files are not copied into the source tree.

## rc.113 evaluation

The evaluation uses the published `effect@4.0.0-rc.113` tag (`d3b837aee8`). It retains newer upstream provider code and tests.

The repeated provider validation helpers and dynamic-schema bypasses are removed. Native schema normalization remains upstream. Deferred streaming validation lives in the shared wrapper and uses `Schema.toEncoded` plus `Schema.decodeUnknownEffect`. No tool handlers run during that check.

The upstream managed-execution fix remains active. Tests run managed and deferred calls concurrently and check their different outcomes. Native dynamic tools use Effect schemas directly; the raw-schema object mutation workaround is outside this supported construction.

Remaining provider patches cover incomplete JSON on output limits, OpenAI length mapping, raw usage, compatible completion evidence, compatible reasoning replay, and shared metadata declarations. Default-mode invalid parameters follow rc.113's native `InvalidOutputError` behavior.

The publishing branch uses rc.113. Tardigrade still requires an Effect dependency upgrade and removal of its dynamic-tool schema mutation before release.

### Validation result

The evaluation passes 230 provider tests, workspace typechecking, lint, and all four package builds. The packed packages pass 28 runtime tests against the published rc.113 runtime. Those evaluation checks used upstream Effect. The scoped release checks use the fixed runtime under the `effect` alias.

The strict packed-consumer declaration check fails in upstream `effect` declarations. Missing names include `EffectTypeId`, `Contextual`, and `AnnotationSchemaConstraint`. A separate file importing only `effect/Effect` reproduces the missing `AnnotationSchemaConstraint` errors without importing Clavia packages.

[Upstream fix 8162](https://github.com/Effect-TS/effect/pull/8162) removes the dangling internal declaration references. It is after the rc.113 release tag. The fork includes this commit and publishes the fixed runtime as `@tardie/effect`. The strict consumer check remains enabled.

The compatible provider's metadata patch also includes the new `promptCacheBreakpoint` type to match the shared OpenAI declaration. After this correction, the strict consumer check reports only upstream Effect errors.

Evidence logs are `/tmp/effect-rc113-final-tests.log`, `/tmp/effect-rc113-packed-runtime.log`, `/tmp/effect-rc113-consumer-final.log`, and `/tmp/effect-rc113-baseline-types.log`. The evaluation is promoted to the publishing branch. The five packages are published under `@tardie` with the `next` tag.

## Runtime declaration fix

Upstream commit `716e0c00942b42d36631b3114b1deb9a4a944ce3` removes dangling internal declaration references and adds a declaration check. The commit is applied intact. The scoped runtime uses the `effect` alias, and the release check imports every public non-wildcard runtime entrypoint with `skipLibCheck: false`.

Validation passes: 230 provider tests, 28 packed consumer tests, workspace typechecking, lint, and five package builds. The strict packed consumer check passes for all public non-wildcard runtime entrypoints. `npm ls effect` shows one scoped runtime shared by all providers and `@effect/vitest`.

## Publication

The initial release contains `@tardie/effect@4.0.0-rc.113`, `@tardie/ai@0.0.1`, and three providers at `4.0.0-rc.113-clavia.0`. Registry archive integrity matches the checked packages. Each package trusts `clavia-labs/effect`, workflow `clavia-publish.yml`, environment `npm`, for GitHub publication. No npm token secret is required.

## Upstream runtime compatibility

The provider compatibility release uses `@tardie/ai@0.0.2` and provider suffix `rc.113-clavia.1`, with exact upstream Effect rc.115 peers. Provider source remains based on rc.113. The release script publishes four provider packages and checks their archives against the published upstream runtime. It no longer packages or publishes `@tardie/effect`.

The packed consumer imports every public runtime entrypoint with `skipLibCheck: false`, runs the shared provider contracts, and checks that npm resolves one upstream runtime.

## Responses stream sentinel

OpenRouter can append `[DONE]` after its terminal response event. The OpenAI client handles the sentinel before schema decoding, including when both arrive in one network chunk. Response events retain schema validation. A bare sentinel produces no completion event, and malformed JSON before completion still fails.

`packages/ai/openai/test/OpenAiClient.test.ts` checks completed, incomplete, and failed terminal events with combined and separate chunks. Tardigrade also checks the installed package with a combined-chunk fixture. The fix ships in `@tardie/ai-openai@4.0.0-rc.113-clavia.2`.

## Bedrock provider

`packages/ai/bedrock` supplies `@tardie/ai-bedrock`. It translates AWS Converse streams into Effect prompts, response parts, and AiError. AWS owns event-stream decoding; the provider owns Converse mapping, signed and redacted reasoning, token usage, and cancellation. It uses the shared deferred-validation wrapper.

`test/BedrockLanguageModel.test.ts` covers prompt/tool changes, native reasoning replay, isolated tool validation, fragmented and corrupted AWS frames, cancellation, error classification, and usage metadata. Tardigrade retains its binding tests for rejected-call repair, incomplete streams, truncation, and durable evidence.

Cloudflare gateway authentication and Tardigrade request policies remain outside this package. The initial scope is streamText only; generateText fails explicitly. This is a fork provider, not an upstream Effect package.

## Provider boundary regressions

OpenAI preserves explicit `include` values before adding inferred fields. Deployment aliases can request encrypted reasoning regardless of model-name detection or `store`. The compatible provider rejects `n` other than 1 before transport and rejects unexpected alternative choice indexes while streaming. Effect LanguageModel exposes a single response.

Anthropic derives its streaming delta schema from the generated schema and permits omitted input and cache counters. The response accumulator retains earlier counters for null or absent updates and accepts an explicit zero. The usage override retains generated field validators. The wire contract is shown in the [Anthropic streaming examples](https://platform.claude.com/docs/en/build-with-claude/streaming). The model configuration uses the generated effort union, including `max` and `xhigh`. The pinned codegen input patches both effort enums. Only their declarations were imported from regenerated output; unrelated schema generation changes are excluded.

`packages/ai/clavia/test/ProviderStreams.test.ts` proves explicit include retention, pre-request choice rejection, interleaved-choice rejection, and partial usage accumulation. The full provider suite passes 271 tests. These changes are prepared for OpenAI `rc.113-clavia.3`, Anthropic `rc.113-clavia.2`, and compatible `rc.113-clavia.2`.

## OpenRouter native replay

`@tardie/ai-openrouter@4.0.0-rc.113-clavia.1` supplies the native OpenRouter LanguageModel. The shared constructor applies scoped response formats and deferred tool validation. The stream decoder retains routed-provider identity, including when it appears before the usage chunk. Tool arguments are parsed after completion; malformed JSON produces a typed error after response evidence, and token limits retain usage without dispatching partial calls.

`packages/ai/clavia/test/ProviderStreams.test.ts` extends the shared contracts to OpenRouter, including reasoning replay after JSON restoration. Tardigrade tests persistence of native reasoning details, routing metadata, and cost evidence. Provider-native reasoning details are kept in the encoded Effect Prompt, as described in [OpenRouter reasoning replay](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

## Provider configuration schemas (unreleased)

Each provider exports `ConfigSchema` and `ModelConfigSchema` from its language-model module. `ConfigSchema.Encoded` supplies the configuration service type. `ModelConfigSchema` follows the options accepted alongside a model identifier. OpenAI, Anthropic, and OpenRouter derive fields from their generated request schemas. Compatible providers retain extension fields. Bedrock validates Converse settings without importing the AWS client at runtime.

`packages/ai/clavia/test/ConfigSchema.test.ts` checks JSON round trips, optional settings, invalid values, and unknown fields. The adjacent `ConfigSchema.types.ts` and `packages/ai/bedrock/test/ConfigSchema.types.ts` check compatibility with the previous provider contracts, including the AWS SDK input type. Tardigrade has not yet replaced its configuration allowlists with these schemas.

## Bedrock tool history without active tools

Native history is the default. Requests with no active tools, including `toolChoice: "none"`, reject native tool history before transport. Set `toolHistory: "text"` to convert historical calls and results into escaped `<tool_call>` and `<tool_result>` text blocks when no tools are enabled. The conversion preserves IDs, names, arguments, results, and failure status. It omits historical reasoning from the rewritten request and adds a system instruction treating the tagged history as data. Active-tool requests preserve native history and reasoning. The input Prompt remains unchanged, and the adapter option is not sent to AWS.

`packages/ai/bedrock/test/BedrockLanguageModel.test.ts` covers both policies with enabled, removed, and disabled tools, including failed results, delimiter escaping, and signed and redacted reasoning.

## Bedrock HTTP error evidence

The Bedrock adapter retains available HTTP status and allowlisted diagnostic response headers in `reason.metadata.bedrock.response`, plus the SDK request ID when supplied. A non-JSON error response reports its HTTP status with the decoding failure as secondary metadata. Recognized plaintext `error code: NNNN` responses retain the upstream code without storing arbitrary response content. Existing error classification and retryability remain unchanged.

The AWS SDK may leave buffered bytes readable after decoding fails, but a streamed body can already be consumed. The adapter reads retained bytes or strings, or recognizes the code in the SDK's JSON-error excerpt. It does not reread a consumed stream, invent request details, or retain cookies and authorization headers. An unavailable code stays absent.

`packages/ai/bedrock/test/BedrockLanguageModel.test.ts` exercises the real SDK with synthetic HTTP 503 responses using buffered and streamed bodies. It also checks metadata retention across error classes, Effect schema serialization, and exclusion of arbitrary response content.
