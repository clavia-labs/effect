import { assert, describe, it } from "@effect/vitest"
import { AnthropicLanguageModel } from "@tardie/ai-anthropic"
import { BedrockLanguageModel } from "@tardie/ai-bedrock"
import { OpenAiLanguageModel } from "@tardie/ai-openai"
import { OpenAiLanguageModel as CompatibleLanguageModel } from "@tardie/ai-openai-compat"
import { OpenRouterLanguageModel } from "@tardie/ai-openrouter"
import { Schema } from "effect"

const cases = [
  ["OpenAI", OpenAiLanguageModel.ModelConfigSchema, {
    store: false,
    include: ["reasoning.encrypted_content"],
    temperature: 0.3,
    metadata: { experiment: "fixture" },
    text: { verbosity: "low" }
  }, { temperature: "hot" }],
  ["Anthropic", AnthropicLanguageModel.ModelConfigSchema, {
    thinking: { type: "adaptive" },
    output_config: { effort: "max" },
    cache_control: { type: "ephemeral" },
    temperature: 0.3,
    stop_sequences: ["END"]
  }, { thinking: { type: "bogus" } }],
  ["OpenRouter", OpenRouterLanguageModel.ModelConfigSchema, {
    reasoning: { effort: "high" },
    provider: { order: ["Anthropic"], allow_fallbacks: false },
    temperature: 0.3
  }, { provider: { allow_fallbacks: "yes" } }],
  ["compatible", CompatibleLanguageModel.ModelConfigSchema, {
    temperature: 0.3,
    vendor_setting: { enabled: true },
    reasoning_effort: "high"
  }, { temperature: "hot" }],
  ["Bedrock", BedrockLanguageModel.ModelConfigSchema, {
    inferenceConfig: { temperature: 0.3, stopSequences: ["END"] },
    additionalModelRequestFields: { thinking: { type: "enabled", budget_tokens: 1024 } },
    performanceConfig: { latency: "optimized" },
    serviceTier: { type: "flex" }
  }, { performanceConfig: { latency: "instant" } }]
] as const

describe("provider configuration schemas", () => {
  for (const [name, schema, valid, invalid] of cases) {
    it(`${name} preserves JSON settings and rejects invalid known fields`, () => {
      const decode = Schema.decodeUnknownSync(schema as Schema.Codec<unknown>, { onExcessProperty: "error" })
      assert.deepStrictEqual(decode(JSON.parse(JSON.stringify(valid))), valid)
      assert.deepStrictEqual(decode({}), {})
      assert.throws(() => decode(invalid))
      if (name !== "compatible") {
        assert.throws(() => decode({ tools: [] }))
        assert.throws(() => decode({ model: "accidental-override" }))
        assert.throws(() => decode({ unknown_setting: true }))
      }
    })
  }
})
