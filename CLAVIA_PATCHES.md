# Clavia provider patches

Base: `effect@4.0.0-rc.113`. Publishing branch: `clavia/ai-providers`.

This fork carries provider changes for Tardigrade. The Effect runtime includes upstream declaration fix #8162. The provider packages use the `@clavia` scope. `@tardie/ai` supplies their shared factory wrapper.

## Stable 4.0.1 migration ledger

This ledger is the provider source of truth. Tardigrade keeps integration coverage and consumes the published `@tardie` packages.

| Patch | Area | Status against Effect 4.0.1 | Fork action | Evidence |
| --- | --- | --- | --- | --- |
| Deferred tool validation | Shared wrapper | Not upstreamed | Keep the wrapper validation path and deferred `ToolCallValidationError` behavior | `packages/ai/clavia/test/ProviderStreams.test.ts` |
| Scoped response formats | Shared wrapper | Fork-owned | Keep `ResponseFormat` and text versus object precedence | `packages/ai/clavia/test/LanguageModel.test.ts` |
| Output-limit completion | All providers | Needs verification | Keep provider completion and usage fixtures until stable behavior is confirmed | `packages/ai/clavia/test/ProviderStreams.test.ts` |
| Raw usage metadata | OpenAI, compatible | Not upstreamed | Keep raw finish metadata if the stable provider drops fields required by Tardigrade | Provider stream fixtures |
| Completion evidence | Compatible | Upstreamed in substance | Retain bare-sentinel and missing-finish regressions | `packages/ai/openai-compat/test/OpenAiLanguageModel.test.ts` |
| Reasoning replay | Compatible, OpenRouter | Upstreamed in substance | Retain replay fixtures while the package boundary is replaced | `packages/ai/clavia/test/ProviderStreams.test.ts` |
| Shared approval metadata | Compatible | Upstreamed | Use stable declarations and remove duplicate fork declarations where equivalent | Provider typecheck |
| Nullable stream fields | Compatible | Upstreamed | Keep null and omitted field fixtures | Compatible provider fixtures |
| OpenRouter sentinel | OpenRouter | Upstreamed | Keep combined and segmented sentinel coverage | OpenRouter client fixtures |
| OpenAI Responses sentinel | OpenAI | Not upstreamed | Keep the client parser patch for terminal response plus `[DONE]` chunks | `packages/ai/openai/test/OpenAiClient.test.ts` |
| OpenAI request boundaries | OpenAI | Upstreamed in substance | Retain explicit include and encrypted reasoning regressions | OpenAI provider tests |
| Compatible request boundaries | Compatible | Needs verification | Retain choice count and index regressions | Compatible provider tests |
| Anthropic usage accumulation | Anthropic | Upstreamed in substance | Verify null, omitted, and zero counters | Anthropic provider tests |
| Anthropic thinking display | Anthropic | Not upstreamed | Keep configuration and request mapping until stable exposes the contract | Anthropic config tests |
| Anthropic reasoning usage | Anthropic | Not upstreamed | Keep `thinking_tokens` mapping and declarations | Anthropic usage tests |
| Provider configuration schemas | All providers | Not upstreamed | Keep `ConfigSchema` and `ModelConfigSchema` coverage | Provider config tests |
| Bedrock provider and error policy | Bedrock | Fork-owned | Port and publish the provider from the fork | Bedrock provider tests |

The provider source and contract tests remain on this fork. Tardigrade retains integration tests for replay, retries, continuations, tool dispatch, layer assembly, package isolation, and packed consumers.

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

## Responses stream sentinel

OpenRouter appends `[DONE]` after its terminal response event. JSON decoding previously failed when both arrived in the same network chunk. The OpenAI client now handles the sentinel before schema decoding. Response events retain schema validation. A bare sentinel produces no completion event.

`packages/ai/openai/test/OpenAiClient.test.ts` covers all three terminal events with combined and separate chunks, a bare sentinel, and malformed JSON. Client, language model, and shared stream suites pass 135 tests. Fork lint, type checks, and the OpenAI package build pass.

The Tardigrade live test passed with `openai/gpt-5.6-sol` through OpenRouter using the rebuilt client through a temporary Bun preload. It checked durable reasoning replay through a tool call and completed-turn recovery. Seven inference fixture tests also passed, including rejection of a bare sentinel. Installed dependencies remain unchanged. Publication is pending.
