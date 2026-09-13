import type { ConverseStreamCommandInput } from "@aws-sdk/client-bedrock-runtime"
import type { ModelConfig } from "@tardie/ai-bedrock/BedrockLanguageModel"

type Equivalent<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false
type Assert<T extends true> = T
export type BedrockContract = Assert<
  Equivalent<
    ModelConfig,
    Omit<ConverseStreamCommandInput, "modelId" | "messages" | "system" | "toolConfig" | "outputConfig">
  >
>

type NativeConfig = Omit<ConverseStreamCommandInput, "modelId" | "messages" | "system" | "toolConfig" | "outputConfig">
export type BedrockFields = Assert<Equivalent<keyof ModelConfig, keyof NativeConfig>>
type NestedKeys<T> = { [K in keyof T]-?: keyof NonNullable<T[K]> }
export type BedrockNestedFields = Assert<Equivalent<NestedKeys<ModelConfig>, NestedKeys<NativeConfig>>>
