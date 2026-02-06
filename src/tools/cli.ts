
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const parser = require('yargs-parser');
import { Database } from 'better-sqlite3';
import * as core from './core.js';
import { handleReadGraph } from './graph_reader.js';
import * as taskHandlers from './task_handlers.js';
import * as graphOps from './graph_ops.js';
import * as advancedOps from './advanced_ops.js';

export const CLI_TOOL = {
    name: "cli",
    description: "Single entry point for all tools using a simplified command-line syntax. Saves tokens by replacing strict JSON schemas. Try `help` to see available commands.",
    inputSchema: {
        type: "object",
        properties: {
            command: { 
                type: "string", 
                description: "The command string to execute (e.g., 'remember \"fact\" --tags tag1', 'graph \"Entity\" -d 2', 'task done \"fix bug\"')." 
            }
        },
        required: ["command"]
    }
};

const resolveTaskOrTodoId = (db: Database, table: 'tasks' | 'todos', identifier: string): string | null => {
    // 1. Try Exact ID match
    const byId = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(identifier) as any;
    if (byId) return byId.id;

    // 2. Try Exact Content match (pending first)
    const byContentExact = db.prepare(`SELECT id FROM ${table} WHERE content = ? AND status != 'complete' LIMIT 1`).get(identifier) as any;
    if (byContentExact) return byContentExact.id;

    // 3. Try Fuzzy Content match (LIKE %...%)
    const byContentFuzzy = db.prepare(`SELECT id, content FROM ${table} WHERE content LIKE ? AND status != 'complete' LIMIT 5`).all(`%${identifier}%`) as any[];
    
    if (byContentFuzzy.length === 1) {
        return byContentFuzzy[0].id;
    }
    
    if (byContentFuzzy.length > 1) {
        throw new Error(`Ambiguous match for "${identifier}". Found: ${byContentFuzzy.map(t => `"${t.content}"`).join(', ')}`);
    }

    return null;
};

export const handleCLI = async (
    db: Database,
    embedder: any,
    archivist: any,
    commandString: string,
    extensions: any[] = []
) => {
    // 1. Parse Args
    const args = parser(commandString, {
        alias: {
            limit: ['n', 'count', 'amount'],
            depth: ['d'],
            tags: ['t'],
            json: ['j'],
            center: ['c'],
            section: ['s'],
            status: ['st'],
            id: ['i'],
            due: ['date'],
            k: ['clusters']
        },
        configuration: {
            'parse-numbers': true,
            'boolean-negation': false
        }
    });

    const verbs = args._.map(String);
    if (verbs.length === 0) {
        return { content: [{ type: "text", text: "No command provided. Try 'help'." }], isError: true };
    }

    const action = verbs[0].toLowerCase();

    // 2. Help
    if (action === 'help' || args.help) {
        const extensionHelp = extensions.length > 0 ? `
Extensions:
  ${extensions.map(e => `${e.tool.name}        ${e.tool.description}`).join('\n  ')}
` : '';

        return {
            content: [{
                type: "text",
                text: `
=== MCP CLI Help ===

syntax: <command> [arguments] [flags]

Commands:
  remember <text...>        Save one or more facts. 
                            Usage: remember "fact1" "fact2" --tags t1 t2
  
  recall <query>            Search memories.
                            Usage: recall "python" --limit 5
  
  graph <center?>           View knowledge graph.
                            Usage: graph "Antigravity" --depth 2
  
  todo <add|list|done>      Manage todos.
                            Usage: todo add "buy milk"
                                   todo list --status pending
                                   todo done "milk" (closes by name!)
  
  task <add|list|upd|del>   Manage tasks.
                            Usage: task add "Fix bug" --section dev
                                   task list
                                   task done "Fix bug" (closes by name!)

  entity <create|upd|del>   Manage entities.
                            Usage: entity create "Jules" --type "AI" --obs "Cool"
                                   entity update "Jules" --name "Jules V2" --type "AGI"
                                   entity delete "Jules"
  
  relation <create|del>     Manage relations.
                            Usage: relation create "A" "B" "knows"
                                   relation delete "A" "B" "knows"
  
  observation <del>         Delete observations.
                            Usage: observation del "Entity" "Obs1" "Obs2"

  cluster <k?>              Cluster memories.
                            Usage: cluster --k 5
  
  export <path>             Export memories to JSON.
                            Usage: export "./backup.json"
                            
  init <name?>              Init conversation.
                            Usage: init "Project Delta"

  forget <id>               Delete a memory.
${extensionHelp}
Flags:
  --tags, -t      Tags
  --limit, -n     Check limit
  --depth, -d     Graph depth
  --json, -j      Return JSON
`
            }]
        };
    }

    // 3. Routing
    try {
        switch (action) {
            case 'remember': 
            // ... (rest of cases unchanged) ...
            case 'save': {
                const inputs = verbs.slice(1);
                if (inputs.length === 0) return { content: [{ type: "text", text: "Usage: remember <text...>" }], isError: true };
                
                const tags = Array.isArray(args.tags) ? args.tags : (args.tags ? [args.tags] : []);

                if (inputs.length === 1) {
                    return await core.handleRememberFact(db, embedder, archivist, { text: inputs[0], tags });
                } else {
                    const facts = inputs.map((text: string) => ({ text, tags }));
                    return await core.handleRememberFacts(db, embedder, archivist, { facts });
                }
            }

            case 'recall':
            case 'search': {
                const query = verbs.slice(1).join(' ');
                if (!query) return { content: [{ type: "text", text: "Usage: recall <query>" }], isError: true };
                return await core.handleRecall(db, embedder, {
                    query,
                    limit: args.limit,
                    json: args.json,
                    startDate: args.startDate,
                    endDate: args.endDate
                });
            }
            
            case 'graph':
            case 'read_graph': {
                const center = verbs.slice(1).join(' ') || args.center;
                return handleReadGraph(db, {
                    center,
                    depth: args.depth,
                    json: args.json
                });
            }

            case 'forget': {
                const id = verbs[1];
                if (!id) return { content: [{ type: "text", text: "Usage: forget <id>" }], isError: true };
                return core.handleForget(db, { memory_id: id });
            }

            case 'history':
            case 'recent': {
                return core.handleListRecent(db, { limit: args.limit, json: args.json });
            }
            
            case 'cluster': {
                return advancedOps.handleClusterMemories(db, { k: args.k });
            }
            
            case 'export': {
                const path = verbs[1] || args.path;
                if (!path) return { content: [{ type: "text", text: "Usage: export <path>" }], isError: true };
                return advancedOps.handleExportMemories(db, { path });
            }

            case 'init': 
            case 'start': {
                const name = verbs.slice(1).join(' ');
                const res = taskHandlers.handleInitConversation(db, { name });
                return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
            }

            // --- Sub-commands ---
            
            case 'todo': {
                const sub = verbs[1];
                const content = verbs.slice(2).join(' ');
                
                if (sub === 'add' || sub === 'new') {
                    if (!content) return { content: [{ type: "text", text: "Usage: todo add <content>" }], isError: true };
                    return taskHandlers.handleAddTodo(db, { content, due_date: args.due });
                }
                if (sub === 'list' || sub === 'ls') return taskHandlers.handleListTodos(db, { status: args.status, limit: args.limit });
                if (sub === 'done' || sub === 'complete' || sub === 'finish') {
                    const selector = verbs[2] || content;
                    if (!selector) return { content: [{ type: "text", text: "Usage: todo done <id|content>" }], isError: true };
                    
                    const resolvedId = resolveTaskOrTodoId(db, 'todos', selector);
                    if (!resolvedId) return { content: [{ type: "text", text: `Todo "${selector}" not found.` }], isError: true };
                    
                    return taskHandlers.handleCompleteTodo(db, { id: resolvedId });
                }
                return { content: [{ type: "text", text: "Unknown todo command. Try: add, list, done" }], isError: true };
            }

            case 'task': {
                const sub = verbs[1];
                const rest = verbs.slice(2).join(' ');
                
                if (sub === 'add' || sub === 'new') {
                    if (!rest) return { content: [{ type: "text", text: "Usage: task add <content>" }], isError: true };
                    return taskHandlers.handleAddTask(db, { 
                        content: rest, 
                        section: args.section, 
                        conversation_id: args.conversation_id 
                    });
                }
                if (sub === 'list' || sub === 'ls') return taskHandlers.handleListTasks(db, { 
                    conversation_id: args.conversation_id, 
                    status: args.status 
                });
                if (sub === 'update' || sub === 'status') {
                    const id = verbs[2];
                    const status = verbs[3] || args.status;
                    if (!id || !status) return { content: [{ type: "text", text: "Usage: task update <id> <status>" }], isError: true };
                    return taskHandlers.handleUpdateTaskStatus(db, { id, status });
                }
                if (sub === 'done' || sub === 'complete' || sub === 'finish') {
                    const selector = verbs[2] || rest;
                    if (!selector) return { content: [{ type: "text", text: "Usage: task done <id|content>" }], isError: true };

                    const resolvedId = resolveTaskOrTodoId(db, 'tasks', selector);
                    if (!resolvedId) return { content: [{ type: "text", text: `Task "${selector}" not found.` }], isError: true };

                    return taskHandlers.handleUpdateTaskStatus(db, { id: resolvedId, status: 'complete' });
                }
                if (sub === 'del' || sub === 'delete') {
                    const selector = verbs[2] || rest;
                    if (!selector) return { content: [{ type: "text", text: "Usage: task del <id|content>" }], isError: true };
                    
                    const resolvedId = resolveTaskOrTodoId(db, 'tasks', selector);
                    if (!resolvedId) return { content: [{ type: "text", text: `Task "${selector}" not found.` }], isError: true };

                    return taskHandlers.handleDeleteTask(db, { id: resolvedId });
                }
                return { content: [{ type: "text", text: "Unknown task command. Try: add, list, update, done, del" }], isError: true };
            }

            case 'entity': {
                const sub = verbs[1];
                if (sub === 'create') {
                    const name = verbs.slice(2).join(' ');
                    if (!name) return { content: [{ type: "text", text: "Usage: entity create <name> --type <type>" }], isError: true };
                    const obs = args.obs ? (Array.isArray(args.obs) ? args.obs : [args.obs]) : [];
                    return graphOps.handleCreateEntity(db, { name, type: args.type || 'Unknown', observations: obs }, embedder);
                }
                if (sub === 'update') {
                    const name = verbs.slice(2).join(' '); // or args.name
                    if (!name) return { content: [{ type: "text", text: "Usage: entity update <name> --name <new> --type <new>" }], isError: true };
                    return graphOps.handleUpdateEntity(db, { current_name: name, new_name: args.name, new_type: args.type }, embedder);
                }
                if (sub === 'delete' || sub === 'del') {
                    const name = verbs.slice(2).join(' ');
                    if (!name) return { content: [{ type: "text", text: "Usage: entity delete <name>" }], isError: true };
                    return graphOps.handleDeleteEntity(db, { name });
                }
                return { content: [{ type: "text", text: "Entity commands: create, update, delete" }], isError: true };
            }

            case 'relation': {
                const sub = verbs[1];
                // args: relation create "A" "B" "knows"
                const inputs = verbs.slice(2); 
                
                if (sub === 'create') {
                   // Expect 3 args: Source, Target, Relation. OR Source Target Relation (split by spaces if quoted?)
                   // verbs split by spaces but quotes might be handled by yargs-parser if passed cleanly?
                   // yargs parser `_` array treats quoted strings as single items usually if shell passed correctly.
                   if (inputs.length < 3) return { content: [{ type: "text", text: "Usage: relation create <source> <target> <relation>" }], isError: true };
                   return graphOps.handleCreateRelation(db, { source: inputs[0], target: inputs[1], relation: inputs[2] });
                }
                if (sub === 'delete' || sub === 'del') {
                   if (inputs.length < 3) return { content: [{ type: "text", text: "Usage: relation delete <source> <target> <relation>" }], isError: true };
                   return graphOps.handleDeleteRelation(db, { source: inputs[0], target: inputs[1], relation: inputs[2] });
                }
                return { content: [{ type: "text", text: "Relation commands: create, delete" }], isError: true };
            }
            
            case 'observation': {
                const sub = verbs[1];
                if (sub === 'del' || sub === 'delete') {
                    // observation del "Entity" "Obs1" "Obs2"
                    const entity = verbs[2];
                    const obsToDelete = verbs.slice(3);
                    if (!entity || obsToDelete.length === 0) return { content: [{ type: "text", text: "Usage: observation del <entity> <obs...>" }], isError: true };
                    return graphOps.handleDeleteObservation(db, { entity_name: entity, observations: obsToDelete });
                }
                return { content: [{ type: "text", text: "Observation commands: del" }], isError: true };
            }

            default: {
                // Check extensions
                const extension = extensions.find(ext => ext.tool.name === action);
                if (extension) {
                    // Map CLI args to tool args if possible?
                    // Extensions usually expect structured JSON arguments. 
                    // We can pass the 'args' object from yargs, but it might contain extra stuff.
                    // Or we could pass 'commandString' if the extension supports CLI parsing?
                    // Most extensions likely expect specific named arguments. 
                    // For now, let's pass the raw args object and hope yargs parsed it compatibly?
                    // OR: Assume CLI user knows flags match argument names.
                    const result = await extension.handler(db, args);
                    return {
                        content: [{ 
                            type: "text", 
                            text: JSON.stringify(result, null, 2) 
                        }]
                    };
                }
                
                return { content: [{ type: "text", text: `Unknown command '${action}'. Try 'help'.` }], isError: true };
            }

        }
    } catch (err: any) {
        return {
            content: [{ type: "text", text: `CLI Error: ${err.message}` }],
            isError: true
        };
    }
};
