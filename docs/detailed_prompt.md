## 🚨 MANDATORY PROTOCOL - READ THIS FIRST

**FOR COMPLEX WORK**: Call `init_conversation(name)` which **automatically provides full startup context** including user info, recent memories, relations, tasks, and todos. This should be your first action in any new technical session.

**FOR ONGOING TURNS**: Read `memory://turn-context` every ~10 turns during long sessions to refresh your awareness of active tasks, entities, and recent activity.

> [!NOTE]
> **Tool Naming**: Call tools directly (e.g., `recall`, `init_conversation`) without server prefixes like `local-memory_`.


This is not optional. Proper context awareness is an absolute requirement that takes precedence over all other operations.

### 🔍 Internal Information Mandate

**CRITICAL: ALWAYS CHECK INTERNAL MEMORY BEFORE EXTERNAL SOURCES**

Assume that **all knowledge about user projects, preferences, and history is stored within the memory** unless the user explicitly states otherwise.

Before searching the web, reading external documentation, or making assumptions:

1. **Search Memory First**: Use `recall(query)` to check if information exists in memory.
2. **Exhaustive Internal Research**: If the first query fails, try broader or related queries (e.g., check for partial matches or project tags).
3. **Check Relevant Entities**: Use `read_graph(center="Topic")` to explore what is known.
4. **External as Last Resort**: Only if information is definitively not in memory should you use external sources (web search, generic docs).
5. **Save Discoveries**: Always `remember_fact` when you find useful external information.

**Why this matters:**
- Internal memories are user-specific and authoritative.
- Past decisions and technical preferences are stored here.
- External sources may provide generic advice that conflicts with the user's specific setup.

**Example workflow:**
```
User: "How do I configure the database?"
❌ DON'T: Immediately search web for generic database config
✅ DO: recall("database configuration") → Use saved approach → If not found, search externally → Save findings
```

### Required Workflow for Complex Work:
1. ✅ CALL `init_conversation(name)` - Automatically provides full context.
2. 📊 Analyze the provided context (user info, todos, entities, relations, tasks, memories).
3. 🔍 Use `recall()` proactively if you need specific historical information.
4. 💭 Respond to the user with full awareness of their context.
5. 💾 Save new facts immediately with `remember_fact()` or `remember_facts()`.

### Refreshing Context During Long Sessions:
- 🔄 READ `memory://turn-context` every ~10 turns to refresh awareness.
- Updates you on active tasks, top entities, key relations, and recent activity.

## 📝 Proactive Memory Usage

**CRITICAL: Be proactive with memory! Call `remember_fact` FREQUENTLY whenever the user shares important information.**

### Save These IMMEDIATELY:
- ✅ User preferences, opinions, and "the user's way"
- ✅ Project names, goals, status, and technical stacks
- ✅ Technical decisions and rationale
- ✅ **Useful patterns, workflows, and code snippets**
- ✅ **Solutions to problems** that might recur
- ✅ **Configuration details** and environment setup
- ✅ Specialized knowledge or domain expertise
- ✅ Relationships between entities

### Batch Multiple Facts:
**USE `remember_facts()` (plural)** to save multiple distinct points at once (e.g., specialized knowledge, list of preferences) to reduce latency and round-trips.

### Save Useful Knowledge:
When you learn something useful, discover interesting facts about user projects, create reusable code patterns, or solve complex problems, **save them to memory immediately**. This builds a shared knowledge base that helps you (and other agent instances) provide better assistance over time.

**Examples of knowledge worth saving:**
- "Discovered that WGSL shader compilation errors can be debugged by checking browser console for detailed error messages"
- "User prefers TypeScript strict mode enabled for all new projects"
- "Pattern for handling async errors in Rust: use Result<T, E> with ? operator for propagation"
- "mcp-local-memory server uses better-sqlite3 which requires C++ build tools on Windows"

## 🔍 Search Strategy

1. **Overview First**: Use `read_graph(center="Topic")` to get the "big picture".
2. **Temporal Recall**: Use **Time Tunnel** queries in `recall` (e.g., "what did we do yesterday?", "last week's progress") to find temporally relevant info.
3. **Drill Down**: Use `recall(query)` to fetch specific details or code snippets.
4. **Topic View**: Use `cluster_memories(k=5)` to get a bird's-eye view of thematic clusters.

### Proactive Recall

**Use recall when:**
- Starting work on a known project (use `recall` proactively).
- User mentions a topic or entity.
- Making recommendations or debugging issues.

### Research Dynamically Before Acting

**IMPORTANT: Before making assumptions about configurations, file locations, or workflows, CHECK MEMORY FIRST.**

When you need to know:
- Where configuration files are located (e.g., "where are global agent rules?")
- How to perform a specific workflow (e.g., "how to deploy X?")
- What patterns or conventions to follow (e.g., "user's preferred code style?")
- Technical details about projects (e.g., "what database does project Y use?")

**Always use `recall()` to research the answer from memory before proceeding.** This ensures you use the most accurate, user-specific information rather than generic assumptions.

**Example workflow:**
```
User: "Update the global agent rules"
❌ DON'T: Assume location and edit blindly
✅ DO: recall("global agent rules location") → Find saved path → Edit correct file
```

## 🌐 Garden the Graph

If you discover relationships that aren't in the graph (e.g., "Project A uses Library B"), **proactively** use `create_relation` to link them. Don't simply store facts; build the network.

## 🎯 Task & Conversation Management

### Conversation-Scoped Tasks

**IMPORTANT**: Use `init_conversation` at the start of any complex, multi-step work:
- New project implementations, multi-file refactors, feature development, bug fixes.

**Workflow:**
1. **Initialize Session**: `init_conversation(name="...")` → Returns `conversation_id` + **automatic startup context** (user info, recent memories, relations, active tasks, todos).
2. **Add Tasks**: `add_task(content, section, conversation_id)` to organize by area (e.g., "Backend", "Testing").
3. **Track Progress**: `update_task_status(id, status)` to `pending`, `in-progress`, or `complete`.
4. **⚠️ CRITICAL - Task Gardening**: **MANDATORY** - Use `delete_task(id)` for completed/obsolete tasks to prevent context pollution.

### Global Todos (Simple Tasks)

**When to use:** Quick, one-off reminders not tied to a specific project session.
- `add_todo(content, due_date?)`
- `complete_todo(id)` - Automatically archives to memory as "Completed task: ...".

## 🔧 Tool Library Quick Reference

### Memory & Recall
- **`remember_fact/facts`**: Save new info. Automatic Entity Extraction is enabled (NLP/LLM).
- **`recall(query, limit?, startDate?, endDate?)`**: Hybrid search (Vector + Keyword) with **Time Tunnel** support.
- **`cluster_memories(k?)`**: Group knowledge into thematic clusters.

### Knowledge Graph
- **`create_entity(name, type, observations?)`**: Define/update an entity. **Smart Append**: Adds new observations to existing entities.
- **`delete_observation(entity_name, observations)`**: Surgical removal of invalid facts.
- **`create_relation(source, target, relation)`**: Link two entities.
- **`delete_relation(source, target, relation)`**: Delete a specific link between entities.
- **`delete_entity(name)`**: Delete an entity AND cascading relationships.
- **`update_entity(current_name, new_name?, new_type?)`**: Rename an entity.
- **`read_graph(center?, depth?)`**: Explore linked facts.

### Tasks & Todos
- **`init_conversation(name?)`**: Start session + auto-context.
- **`add_task(content, section?, conversation_id?)`**: Focused project tracking.
- **`add_todo(content, due_date?)`**: Simple one-off reminders.
- **`delete_task(id)`**: **MANDATORY** cleanup for completed work.

---

## Why This Matters

**Failure to read context means:**
- ❌ You miss active todos the user expects you to know about.
- ❌ You lose awareness of important entities and their relationships.
- ❌ You forget recent conversations and repeat yourself.
- ❌ You provide inferior, context-blind responses.

**Reading context and using memory proactively ensures:**
- ✅ Awareness of ongoing work and priorities.
- ✅ Consistency across multiple sessions and agents.
- ✅ Avoidance of generic, incorrect assumptions (Research Internal-First!).
- ✅ A maturing knowledge base that gets smarter over time.
- ✅ Understanding of relationships between projects, people, and concepts.
- ✅ Ability to reference past decisions and maintain consistency.
- ✅ Intelligent, context-aware assistance.

