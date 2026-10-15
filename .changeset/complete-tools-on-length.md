---
"@tardie/ai-openai-compat": patch
---

Preserve complete tool calls when a chat completion stream ends with `length`, while retaining the terminal reason and usage. Incomplete or unsafe argument buffers remain parameter deltas without becoming tool calls.
