/**
 * Provider construction with scoped text response formats.
 *
 * @since 0.0.1
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as AiError from "effect/unstable/ai/AiError"
import * as LanguageModel from "effect/unstable/ai/LanguageModel"
import type * as Response from "effect/unstable/ai/Response"

/**
 * ResponseFormat supplies the provider format for text generation within its context.
 * Object generation retains its own schema (test/LanguageModel.test.ts).
 *
 * @category services
 * @since 0.0.1
 */
export class ResponseFormat extends Context.Service<ResponseFormat, LanguageModel.ProviderOptions["responseFormat"]>()(
  "@tardie/ai/ResponseFormat"
) {}

const optionsWithFormat = (options: LanguageModel.ProviderOptions) =>
  Effect.map(
    Effect.serviceOption(ResponseFormat),
    (format) =>
      format._tag === "Some" && options.responseFormat.type === "text"
        ? { ...options, responseFormat: format.value }
        : options
  )

const DeferredToolCalls = Context.Reference<boolean>("@tardie/ai/DeferredToolCalls", { defaultValue: () => false })

const validateToolCall = (options: LanguageModel.ProviderOptions) =>
  Effect.fnUntraced(function*(part: Response.StreamPartEncoded) {
    if (part.type !== "tool-call" || part.providerExecuted === true) return part
    const tool = options.tools.find((tool) => tool.name === part.name)
    if (tool?.failureMode !== "return") return part
    const result = yield* Effect.result(
      Schema.decodeUnknownEffect(Schema.toEncoded(tool.parametersSchema))(part.params)
    )
    if (result._tag === "Success") return part
    const error = AiError.make({
      module: "LanguageModel",
      method: "validateToolCall",
      reason: new AiError.ToolParameterValidationError({ toolName: part.name, description: result.failure.message })
    })
    return {
      type: "error",
      error: {
        _tag: "ToolCallValidationError",
        id: part.id,
        name: part.name,
        params: part.params,
        cause: Schema.encodeSync(AiError.AiError)(error),
        providerMetadata: part.metadata ?? {}
      }
    } satisfies Response.StreamPartEncoded
  })

/**
 * make constructs an upstream LanguageModel with scoped formats and deferred tool validation.
 * Deferred streaming calls retain return-mode validation errors without executing tools (test/LanguageModel.test.ts).
 *
 * @category constructors
 * @since 0.0.1
 */
export const make: typeof LanguageModel.make = (hooks) =>
  Effect.gen(function*() {
    const model = yield* LanguageModel.make({
      ...hooks,
      generateText: (options) => Effect.flatMap(optionsWithFormat(options), hooks.generateText),
      streamText: (options) =>
        Stream.unwrap(Effect.gen(function*() {
          const deferred = yield* DeferredToolCalls
          const stream = hooks.streamText(yield* optionsWithFormat(options))
          return deferred ? Stream.mapEffect(stream, validateToolCall(options)) : stream
        }))
    })
    // streamText preserves native overloads while supplying a request-local mode (test/LanguageModel.test.ts).
    const streamText = ((options: Parameters<typeof model.streamText>[0]) =>
      model.streamText(options).pipe(
        Stream.provideService(DeferredToolCalls, options.disableToolCallResolution === true)
      )) as typeof model.streamText
    return { ...model, streamText }
  })
