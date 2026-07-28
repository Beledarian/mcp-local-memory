# Agent Guidance for Local Memory

Use this as a starting point for an agent connected to `mcp-local-memory`.
Adapt it to the host application's own tool, privacy, and approval rules.

## Start and Refresh Context

For complex or task-oriented work:

1. Call `init_conversation(name)` and retain the returned `conversation_id`.
2. Read `memory://current-context` separately. `init_conversation` intentionally
   returns only a small payload and does not inline startup context.
3. Scope new tasks with that `conversation_id` when useful.

During a long conversation, read `memory://turn-context` when you need a compact
refresh of active tasks, important entities, relations, and recent activity.
Resource access is client-dependent; do not claim context was loaded unless the
read succeeded.

Call tools by the names exposed by the client, commonly `recall`,
`remember_fact`, and `reinforce_memory`. Do not assume a particular server-name
prefix.

## Recall Before Guessing

Use `recall(query)` for user-specific history, project decisions, configuration
paths, prior fixes, and preferences that could affect the current work. Use
`read_graph(center)` when entity relationships matter.

Recall can also search by time. Put a natural-language date in the query, such
as `what changed last week?`, `decisions from yesterday`, or `work in 2025`.
For a precise range, pass ISO 8601 `startDate` and `endDate`. The date filter
applies to when a memory was created; the remaining query text is used for
topical matching.

Memory is evidence, not unquestionable truth:

- Recall can return fewer results than requested because weak and near-duplicate
  candidates are removed.
- A weak or empty result means the store did not find a sufficiently relevant
  match. It does not prove the fact never existed.
- Verify drift-prone, safety-critical, or externally observable facts against
  current sources when practical.
- Distinguish remembered facts from facts verified in the current turn.

Recall does not increase importance, reinforcement count, or refresh decay.
The server may record a hashed, daily-deduplicated familiarity exposure for a
returned active memory. This provides a small access-based preference on later
recalls; explicit feedback is the stronger path for durable changes.

## Explicit Feedback

After actually evaluating a recalled memory, use:

```text
reinforce_memory(memory_id, signal, reason?)
```

Signals:

- `used`: the memory genuinely contributed to downstream work.
- `important`: the memory was explicitly judged durable and important.
- `irrelevant`: the result was off-topic for the query.
- `incorrect`: the stored claim is false; suppress it from default recall.
- `outdated`: the claim was superseded; retain it for history but suppress it
  from default recall and context.
- `restore`: explicitly make an outdated/incorrect memory active again.

Do not reinforce every returned result. Positive signals have a one-hour
same-signal cooldown, seven-day diminishing gains, and a reinforcement growth
ceiling of `0.95`. Negative feedback lowers importance immediately. All events
are recorded in `memory_feedback`.

Use `forget(memory_id)` when deletion is appropriate or the user asks for it.
Use `incorrect` or `outdated` when retaining an auditable historical record is
preferable. Use `recall(..., include_outdated=true)` only for deliberate
history/audit searches.

## Selective Writing

Save information that is likely to matter across sessions:

- durable user preferences;
- project decisions and their rationale;
- stable paths, commands, or environment constraints;
- confirmed fixes and reusable technical findings;
- explicit goals or commitments.

Avoid saving:

- unverified guesses or speculative conclusions;
- transient chatter and one-off status noise;
- duplicate paraphrases of an existing memory;
- credentials, tokens, or other secrets unless the user explicitly intends
  local persistence and the host policy permits it.

Use `remember_fact(text, tags?)` for one fact and `remember_facts(facts)` for
several independent facts. Keep each fact self-contained enough to be useful in
a later session. Saving waits for embedding and configured archivist work to
finish before acknowledging success.

The configured archivist may derive entities and relations:

- `passive`: no automatic extraction;
- `nlp`: offline rule/NLP extraction;
- `llm`: sends saved text to the configured `OLLAMA_URL`.

## Entities and Relations

Use the graph when the relationship between named concepts matters, rather
than treating every statement as isolated text:

- `create_entity(name, type, observations?)` creates a typed concept or appends
  observations to a matching entity.
- `create_relation(source, target, relation)` creates a directional triple.
  Missing source or target entities are created with type `Unknown`.
- `read_graph(center, depth)` returns direct connections at `depth=1` and one
  additional hop at larger depths, together with observations and related
  memories.
- `update_entity` renames or retypes an entity; renaming also updates its
  relations.
- `delete_observation`, `delete_relation`, and `delete_entity` provide
  progressively broader cleanup.
- `cluster_memories(k)` groups memories and entities into semantic topics when
  embeddings are available.

Prefer `recall` for ranked topical or temporal retrieval. Prefer `read_graph`
for questions such as “what uses this library?”, “how are these projects
connected?”, or “what is known about this entity?”. Use both when a task needs
relevant facts and their surrounding structure.

## Search and Scoring Expectations

`recall` independently attempts semantic vector and FTS5 keyword retrieval,
then merges the candidate sets. Ranking combines:

- vector and keyword relevance;
- reciprocal-rank evidence from both retrieval paths;
- whole-token query coverage;
- proportional exact-tag matches;
- bounded, time-decayed importance;
- bounded recent familiarity, applied only after relevance gating.

Natural-language or explicit date ranges filter candidates before this topical
ranking. A date-only query can return memories from that period in creation
order.

`MEMORY_SEMANTIC_WEIGHT` is retained for compatibility. It now controls
retrieval relevance versus importance, not vector versus keyword search. For
example, `0.9` means 90% retrieval relevance and 10% decayed importance in the
base score.

Candidates must clear `MEMORY_MIN_RELEVANCE`; importance cannot rescue an
unrelated memory. Long queries with weak exact-token coverage use the stronger
`MEMORY_SEMANTIC_ONLY_MIN_RELEVANCE` guard. Near-duplicates are collapsed using
`MEMORY_DEDUP_SIMILARITY`.

Familiarity never changes importance, reinforcement, lifecycle, or decay. It
provides a small ranking contribution from prior qualifying recall exposures;
explicit `reinforce_memory` remains the durable feedback path.

Use `json: true` when structured results are needed and `debug: true` when
diagnosing retrieval method, thresholds, or score components.

## Tasks, Todos, and Graph Maintenance

- `add_task`, `update_task_status`, `list_tasks`, and `delete_task` manage
  conversation-scoped or global work.
- `add_todo`, `complete_todo`, and `list_todos` manage simple global reminders.
- Remove obsolete tasks when they no longer provide useful context.
- `create_entity`, `create_relation`, and their update/delete counterparts
  maintain explicitly structured knowledge.
- Do not create graph relations from uncertain inference without labeling or
  verification.

## Safety and Provenance

The database defaults to `~/.memory/memory.db` and can be overridden with
`MEMORY_DB_PATH`. Treat that file as user data: back it up before migration or
repair, and never delete it as routine troubleshooting.

Memory storage is local. The embedding model may be downloaded on first use.
The optional `llm` strategy sends text to the exact `OLLAMA_URL` configured by
the operator; that endpoint should be treated as a data boundary.

On Windows ARM64, the package uses its checksum-verified bundled
`sqlite-vec` v0.1.9 DLL. If it cannot load, semantic search is disabled and
recall continues through FTS. WSL2 remains a supported deployment alternative.
