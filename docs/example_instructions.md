# Example Agent Instructions

Brief, copy-ready guidance for agents using `mcp-local-memory`.

## Quick Start

- For complex work, call `init_conversation(name)`, retain the returned
  `conversation_id`, then read `memory://current-context`. Initialization itself
  returns only the ID and a reminder; it does not inline the context.
- During long work, read `memory://turn-context` when a refresh would be useful.
- Use direct tool names such as `recall`, without assuming a server-name prefix.

## Memory Practices

- Recall project history and user-specific decisions when they are relevant.
  Treat a weak or empty result as absence of evidence, not proof that no fact
  exists.
- `recall` preserves importance, explicit reinforcement, lifecycle, and decay
  state. It may record bounded hashed familiarity telemetry and may return
  fewer than the requested limit when relevance thresholds or deduplication
  remove weak candidates.
- Call `reinforce_memory` only after evaluating a returned memory:
  `used`, `important`, `irrelevant`, `incorrect`, `outdated`, or `restore`.
- Default recall hides outdated/incorrect memories. Use
  `include_outdated=true` only for explicit historical review.
- Save durable preferences, decisions, and reusable findings. Do not persist
  guesses, secrets without user intent, or transient conversation filler.
- Use `remember_facts` for several independent facts.
- Remove obsolete tasks with `delete_task`; use `forget` when a memory should
  actually be deleted.

For scoring, feedback, and complete tool guidance, see
[detailed_prompt.md](detailed_prompt.md).
