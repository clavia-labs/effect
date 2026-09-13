import type { AnthropicLanguageModel, Generated as Anthropic } from "@tardie/ai-anthropic"
import type { OpenAiLanguageModel, OpenAiSchema } from "@tardie/ai-openai"
import type { OpenAiClient, OpenAiLanguageModel as CompatibleLanguageModel } from "@tardie/ai-openai-compat"
import type { Generated as OpenRouter, OpenRouterLanguageModel } from "@tardie/ai-openrouter"

type Equivalent<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false
type Assert<T extends true> = T

type Common = { readonly strictJsonSchema?: boolean | undefined }
type OpenAiExtras = Common & {
  readonly fileIdPrefixes?: ReadonlyArray<string> | undefined
  readonly text?: { readonly verbosity?: "low" | "medium" | "high" | undefined } | undefined
}

export type OpenAiContract = Assert<
  Equivalent<
    typeof OpenAiLanguageModel.Config.Service,
    & Partial<Omit<typeof OpenAiSchema.CreateResponse.Encoded, "input" | "tools" | "tool_choice" | "stream" | "text">>
    & OpenAiExtras
  >
>
export type AnthropicContract = Assert<
  Equivalent<
    typeof AnthropicLanguageModel.Config.Service,
    & Partial<
      Omit<
        typeof Anthropic.BetaCreateMessageParams.Encoded,
        "messages" | "output_config" | "tools" | "tool_choice" | "stream"
      >
    >
    & Common
    & {
      readonly output_config?: { readonly effort?: typeof Anthropic.BetaEffortLevel.Encoded | null }
      readonly disableParallelToolCalls?: boolean | undefined
      readonly structuredOutputs?: boolean | undefined
    }
  >
>
export type OpenRouterContract = Assert<
  Equivalent<
    typeof OpenRouterLanguageModel.Config.Service,
    Partial<
      Omit<
        typeof OpenRouter.ChatRequest.Encoded,
        "messages" | "response_format" | "tools" | "tool_choice" | "stream" | "stream_options"
      >
    > & Common
  >
>
export type CompatibleContract = Assert<
  Equivalent<
    typeof CompatibleLanguageModel.Config.Service,
    Partial<Omit<OpenAiClient.CreateResponse, "input" | "tools" | "tool_choice" | "stream" | "text">> & OpenAiExtras & {
      readonly [key: string]: unknown
    }
  >
>

export type CompatibleFields = Assert<
  Equivalent<
    keyof typeof CompatibleLanguageModel.ConfigSchema.schema.Type,
    keyof Omit<OpenAiClient.CreateResponse, "input" | "tools" | "tool_choice" | "stream" | "text"> | keyof OpenAiExtras
  >
>
