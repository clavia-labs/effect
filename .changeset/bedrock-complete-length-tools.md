---
"@tardie/ai-bedrock": patch
---

Preserve complete tool calls when a Bedrock stream reaches its output limit, retaining the length terminal and usage while leaving incomplete or unsafe argument buffers as parameter deltas.
