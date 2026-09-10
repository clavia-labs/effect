/**
 * Provider construction with scoped text response formats.
 *
 * @since 0.0.1
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as LanguageModel from "effect/unstable/ai/LanguageModel"

/**
 * ResponseFormat supplies the provider format for text generation within its context.
 * Object generation retains its own schema (test/LanguageModel.test.ts).
 *
 * @category services
 * @since 0.0.1
 */
export class ResponseFormat extends Context.Service<ResponseFormat, LanguageModel.ProviderOptions["responseFormat"]>()(
  "@clavia/ai/ResponseFormat"
) {}

const optionsWithFormat = (options: LanguageModel.ProviderOptions) =>
  Effect.map(
    Effect.serviceOption(ResponseFormat),
    (format) =>
      format._tag === "Some" && options.responseFormat.type === "text"
        ? { ...options, responseFormat: format.value }
        : options
  )

/**
 * make constructs an upstream LanguageModel with scoped provider response formats.
 * Request validation and object decoding remain in Effect (test/LanguageModel.test.ts).
 *
 * @category constructors
 * @since 0.0.1
 */
export const make: typeof LanguageModel.make = (hooks) =>
  LanguageModel.make({
    ...hooks,
    generateText: (options) => Effect.flatMap(optionsWithFormat(options), hooks.generateText),
    streamText: (options) => Stream.unwrap(Effect.map(optionsWithFormat(options), hooks.streamText))
  })
