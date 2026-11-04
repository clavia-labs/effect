import type { AnthropicLanguageModel, Generated as Anthropic } from "@tardie/ai-anthropic"
import type { OpenAiLanguageModel, OpenAiSchema } from "@tardie/ai-openai"
import type { OpenAiClient, OpenAiLanguageModel as CompatibleLanguageModel } from "@tardie/ai-openai-compat"
import type { Generated as OpenRouter, OpenRouterLanguageModel } from "@tardie/ai-openrouter"

type Equivalent<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false
type Assert<T extends true> = T

// Each contract restates the upstream effect@4.1.2 Config type; the schema-derived Config must match it.
type OpenAiExtras = {
  readonly fileIdPrefixes?: ReadonlyArray<string> | undefined
  readonly text?: { readonly verbosity?: "low" | "medium" | "high" | undefined } | undefined
  readonly strictJsonSchema?: boolean | undefined
}

export type OpenAiContract = Assert<
  Equivalent<
    typeof OpenAiLanguageModel.Config.Service,
    & Partial<Omit<typeof OpenAiSchema.CreateResponse.Encoded, "input" | "tools" | "tool_choice" | "stream" | "text">>
    & OpenAiExtras
    & {
      readonly useItemReferences?: boolean | undefined
      readonly reasoningModel?: boolean | undefined
    }
  >
>

// Upstream declares `effort` as "low" | "medium" | "high"; the schema uses the generated level union, which adds xhigh and max.
export type AnthropicContract = Assert<
  Equivalent<
    typeof AnthropicLanguageModel.Config.Service,
    & Partial<
      Omit<
        typeof Anthropic.BetaCreateMessageParams.Encoded,
        "messages" | "output_config" | "tools" | "tool_choice" | "stream"
      >
    >
    & {
      readonly output_config?: { readonly effort?: typeof Anthropic.BetaEffortLevel.Encoded | null }
      readonly disableParallelToolCalls?: boolean | undefined
      readonly structuredOutputs?: boolean | undefined
      readonly midConversationSystemMessages?: boolean | undefined
      readonly strictJsonSchema?: boolean | undefined
    }
  >
>

export type OpenRouterContract = Assert<
  Equivalent<
    typeof OpenRouterLanguageModel.Config.Service,
    & Partial<
      Omit<
        typeof OpenRouter.ChatRequest.Encoded,
        "messages" | "response_format" | "tools" | "tool_choice" | "stream" | "stream_options"
      >
    >
    & { readonly strictJsonSchema?: boolean | undefined }
  >
>

type CompatibleOmitted = "input" | "tools" | "tool_choice" | "stream" | "text" | "store" | "conversation"

export type CompatibleContract = Assert<
  Equivalent<
    typeof CompatibleLanguageModel.Config.Service,
    & Partial<Omit<OpenAiClient.CreateResponse, CompatibleOmitted>>
    & OpenAiExtras
    & { readonly [key: string]: unknown }
  >
>

export type CompatibleFields = Assert<
  Equivalent<
    keyof typeof CompatibleLanguageModel.ConfigSchema.schema.Type,
    keyof Omit<OpenAiClient.CreateResponse, CompatibleOmitted> | keyof OpenAiExtras
  >
>

export type CompatibleModelLimit = Assert<
  Equivalent<
    NonNullable<Parameters<typeof CompatibleLanguageModel.layer>[0]["config"]>["max_output_tokens"],
    number | null | undefined
  >
>
