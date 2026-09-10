export type Provider = "openai" | "anthropic" | "compat"
export type Scenario = "valid" | "invalid" | "malformed" | "length" | "partial-length"

export const eventsFor = (provider: Provider, scenario: Scenario, reasoningField = "reasoning_content") => {
  const length = scenario === "length" || scenario === "partial-length"
  const args = (id: string) =>
    id === "b" && (scenario === "malformed" || scenario === "partial-length")
      ? "{\"path\":"
      : JSON.stringify({ path: id === "b" && scenario === "invalid" ? 123 : id })
  if (provider === "compat") {
    return [
      { choices: [{ index: 0, delta: { [reasoningField]: "Check" } }] },
      {
        choices: [{
          index: 0,
          delta: {
            tool_calls: ["a", "b", "c"].map((id, index) => ({
              index,
              id,
              type: "function",
              function: { name: "read", arguments: args(id) }
            }))
          }
        }]
      },
      { choices: [{ index: 0, delta: {}, finish_reason: length ? "length" : "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.5 } }
    ].map((event) => ({ id: "response", model: "fixture", created: 1, ...event }))
  }
  if (provider === "openai") {
    const reasoning = {
      type: "reasoning",
      id: "rs_a",
      encrypted_content: "opaque-a",
      summary: [{ type: "summary_text", text: "Check" }]
    }
    const calls = ["a", "b", "c"].map((id) => ({
      type: "function_call",
      id: `fc_${id}`,
      call_id: id,
      name: "read",
      arguments: args(id)
    }))
    return [
      { type: "response.output_item.added", output_index: 0, item: reasoning },
      {
        type: "response.reasoning_summary_text.delta",
        item_id: reasoning.id,
        output_index: 0,
        summary_index: 0,
        delta: "Check"
      },
      { type: "response.output_item.done", output_index: 0, item: reasoning },
      ...calls.flatMap((item, index) => [
        { type: "response.output_item.added", output_index: index + 1, item },
        {
          type: "response.function_call_arguments.done",
          output_index: index + 1,
          item_id: item.id,
          arguments: item.arguments
        },
        { type: "response.output_item.done", output_index: index + 1, item }
      ]),
      {
        type: length ? "response.incomplete" : "response.completed",
        response: {
          id: "response",
          created_at: 1,
          model: "fixture",
          status: length ? "incomplete" : "completed",
          ...(length ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
          output: [reasoning, ...calls],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
            cost: 0.5,
            input_tokens_details: { cached_tokens: 3 },
            output_tokens_details: { reasoning_tokens: 2 }
          }
        }
      }
    ]
  }
  return [
    {
      type: "message_start",
      message: {
        id: "message",
        type: "message",
        role: "assistant",
        content: [],
        container: null,
        stop_reason: null,
        stop_sequence: null,
        model: "fixture",
        usage: {
          input_tokens: 10,
          output_tokens: 0,
          inference_geo: null,
          cache_creation: null,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use: null,
          service_tier: "standard"
        }
      }
    },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Check" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "signed" } },
    { type: "content_block_stop", index: 0 },
    ...["a", "b", "c"].flatMap((id, index) => [
      {
        type: "content_block_start",
        index: index + 1,
        content_block: { type: "tool_use", id, name: "read", input: {} }
      },
      { type: "content_block_delta", index: index + 1, delta: { type: "input_json_delta", partial_json: args(id) } },
      { type: "content_block_stop", index: index + 1 }
    ]),
    {
      type: "message_delta",
      delta: { stop_reason: length ? "max_tokens" : "tool_use", stop_sequence: null },
      usage: {
        output_tokens: 5,
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        server_tool_use: null
      }
    },
    { type: "message_stop" }
  ]
}
