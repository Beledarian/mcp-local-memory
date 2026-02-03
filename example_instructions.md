# Example Agent Instructions

Brief example instructions for agents working with the mcp-local-memory server.

## Quick Start

**FOR COMPLEX WORK**: Call `init_conversation(name)` which automatically provides full startup context.

**FOR ONGOING TURNS**: Read `memory://current-context` before other operations.

## Key Practices

- **Internal-First**: Always `recall(query)` before searching externally
- **Proactive Saving**: Use `remember_fact()` immediately for important info
- **Direct Tool Calls**: Omit server prefixes (use `recall` not `local-memory_recall`)
- **Task Gardening**: Use `delete_task()` to remove completed/obsolete tasks

---

**For comprehensive instructions, see [detailed_prompt.md](file:///c:/Users/Laurin/Documents/GitHub/mcp-local-memory/detailed_prompt.md)**
