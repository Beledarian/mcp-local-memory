import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// We'll use Zod for validation but export standard CallToolRequest schema structures/names if needed
// Or just export the helper objects to register tools easily.

export const REMEMBER_FACT_TOOL: any = {
  name: "remember_fact",
  description: "Save an important fact or piece of information to long-term memory. **USE THIS TOOL FREQUENTLY AND PROACTIVELY** whenever the user shares anything worth remembering for future sessions—preferences, projects, goals, decisions, context, etc. Don't wait to be asked; if it seems important, save it immediately. **Automatically extracts entities and relations from saved facts** using the configured archivist strategy (NLP=free, LLM=~200 tokens per call).",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The information to remember. Be concise but include context (e.g., 'User's dog is named Rex' instead of just 'Rex')."
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Keywords to help categorize the memory (e.g., ['personal', 'preference'])."
      }
    },
    required: ["text"]
  }
};

export const REMEMBER_FACTS_TOOL: any = {
  name: "remember_facts",
  description: "Save multiple distinct facts at once. Use this to batch saves and reduce latency.",
  inputSchema: {
    type: "object",
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: {
             text: { type: "string", description: "The fact to remember." },
             tags: { type: "array", items: { type: "string" }, description: "Tags for this specific fact." }
          },
          required: ["text"]
        }
      }
    },
    required: ["facts"]
  }
};

export const RECALL_TOOL: any = {
  name: "recall",
  description: "Search for relevant memories based on a query. Use this to find information from previous conversations that might be relevant to the current context.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search term or natural language question (e.g., 'What is the user's favorite programming language?')."
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (default is 5)."
      },
      startDate: {
        type: "string",
        description: "Filter by start date (ISO 8601). If not provided, will be inferred from the query if possible."
      },
      endDate: {
        type: "string",
        description: "Filter by end date (ISO 8601). If not provided, will be inferred from the query if possible."
      },
      json: {
        type: "boolean",
        description: "If true, returns full JSON structure. If false (default), returns a concise human-readable summary."
      },
      debug: {
        type: "boolean",
        description: "If true, includes debug information (steps taken, scores) in the response. Default: false."
      }
    },
    required: ["query"]
  }
};

export const FORGET_TOOL: any = {
  name: "forget",
  description: "Remove a specific memory using its ID. Use this if the user asks you to forget something or if the information is no longer accurate.",
  inputSchema: {
    type: "object",
    properties: {
      memory_id: {
        type: "string",
        description: "The unique ID of the memory to delete."
      }
    },
    required: ["memory_id"]
  }
};

export const LIST_RECENT_MEMORIES_TOOL: any = {
  name: "list_recent_memories",
  description: "Get the most recently added memories. Useful for seeing the 'latest' context without a specific search query.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Number of recent memories to fetch (default is 10)."
      },
      json: {
        type: "boolean",
        description: "If true, returns full JSON structure. If false (default), returns a concise human-readable summary."
      }
    }
  }
};

export const EXPORT_MEMORIES_TOOL: any = {
  name: "export_memories",
  description: "Back up all stored memories to a local JSON file. Useful for data portability or debugging.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute local path where the JSON file should be saved (e.g., 'C:/Users/Name/backups/memory.json')."
      }
    },
    required: ["path"]
  }
};

export const CREATE_ENTITY_TOOL: any = {
  name: "create_entity",
  description: "Define a structured entity (person, place, topic) in the knowledge graph. This helps link related facts together.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The unique identifier for the entity (e.g., 'Alice', 'Project X')." },
      type: { type: "string", description: "The category (e.g., 'Person', 'Location', 'Project')." },
      observations: { type: "array", items: { type: "string" }, description: "Specific facts about this entity (e.g., ['Works at Google', 'Likes tea'])." }
    },
    required: ["name", "type"]
  }
};

export const CREATE_RELATION_TOOL: any = {
  name: "create_relation",
  description: "Create a relationship link between two existing entities in the graph (e.g., 'Alice' -> 'works at' -> 'Google').",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "The name of the source entity." },
      target: { type: "string", description: "The name of the target entity." },
      relation: { type: "string", description: "The verb describing the relationship (e.g., 'knows', 'authored', 'located_in')." },
      depth: { type: "number", description: "Traversal depth (default 1, max 3)" }
    },
    required: ["source", "target", "relation"]
  }
};

export const DELETE_OBSERVATION_TOOL: any = {
    name: "delete_observation",
    description: "Delete specific observations from an entity. Use this to remove incorrect or outdated facts.",
    inputSchema: {
        type: "object",
        properties: {
            entity_name: { type: "string", description: "The name of the entity." },
            observations: { 
                type: "array", 
                items: { type: "string" }, 
                description: "Array of exact observation strings to delete." 
            }
        },
        required: ["entity_name", "observations"]
    }
};

export const READ_GRAPH_TOOL: any = {
  name: "read_graph",
  description: "Explore the knowledge graph. Use this to see how entities are connected or to get a summary of everything known about a specific entity.",
  inputSchema: {
    type: "object",
    properties: {
      center: { type: "string", description: "Optionally focus on a specific entity. If omitted, returns a general overview of the graph." },
      depth: { type: "number", description: "How many levels of connections to traverse (default 1)." },
      json: {
        type: "boolean",
        description: "If true, returns full JSON structure. If false (default), returns a concise human-readable summary."
      }
    }
  }
};

export const CLUSTER_MEMORIES_TOOL: any = {
  name: "cluster_memories",
  description: "Cluster memories into topics. Useful for getting a high-level overview of what knowledge is stored.",
  inputSchema: {
    type: "object",
    properties: {
      k: { type: "number", description: "Number of topics generate (default 5)." }
    }
  }
};

export const ADD_TODO_TOOL: any = {
    name: "add_todo",
    description: "Create a new todo item.",
    inputSchema: {
        type: "object",
        properties: {
            content: { type: "string", description: "The task description." },
            due_date: { type: "string", description: "Optional due date (ISO 8601 or natural language)." }
        },
        required: ["content"]
    }
};

export const COMPLETE_TODO_TOOL: any = {
    name: "complete_todo",
    description: "Mark a todo as completed. This moves it from the active list to long-term memory.",
    inputSchema: {
        type: "object",
        properties: {
            id: { type: "string", description: "The ID of the todo to complete." }
        },
        required: ["id"]
    }
};

export const LIST_TODOS_TOOL: any = {
    name: "list_todos",
    description: "List current todo items.",
    inputSchema: {
        type: "object",
        properties: {
            status: { type: "string", enum: ["pending", "completed"], description: "Filter by status (default: pending)." },
            limit: { type: "number", description: "Limit number of results (default 20)." }
        }
    }
};

export const CONSOLIDATE_CONTEXT_TOOL: any = {
  name: "consolidate_context",
  description: "OPTIONAL: Extract important facts from a brief conversation summary. Agent provides 50-100 token summary of recent discussion. Tool extracts structured, novel facts using NLP or LLM. Use to catch memories the agent might have missed explicitly saving.",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Brief conversation summary (e.g., 'Discussed Python for data science, TypeScript frustrations, CEOSim project development'). Keep concise to minimize tokens."
      },
      strategy: {
        type: "string",
        enum: ["nlp", "llm"],
        description: "Extraction strategy: 'nlp' (fast, offline) or 'llm' (thorough, requires Ollama). Default: 'nlp'."
      },
      limit: {
        type: "number",
        description: "Maximum memories to extract (default: 5)."
      }
    },
    required: ["text"]
  }
};

export const INIT_CONVERSATION_TOOL: any = {
  name: "init_conversation",
  description: "Initialize a new conversation session with a unique ID. This allows for conversation-scoped task lists. Call this at the start of a conversation to generate a conversation ID. The returned payload is minimal; you MUST subsequent call 'read_resource(memory://current-context)' to get the full context.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Optional name/description for this conversation (e.g., 'Implementing NLP Features')."
      }
    }
  }
};


export const ADD_TASK_TOOL: any = {
  name: "add_task",
  description: "Add a task to the task list. Tasks can be scoped to a specific conversation or be global (null conversation_id). **Remember to remove outdated or completed tasks to prevent pollution.**",
  inputSchema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The task description."
      },
      section: {
        type: "string",
        description: "Optional section/category (e.g., 'Setup', 'Implementation', 'Testing')."
      },
      conversation_id: {
        type: "string",
        description: "Optional conversation ID to scope this task. If null, task is global."
      }
    },
    required: ["content"]
  }
};

export const UPDATE_TASK_STATUS_TOOL: any = {
  name: "update_task_status",
  description: "Update the status of a task. Use this to mark tasks as in-progress or complete. **Remove completed tasks when they're no longer relevant to keep the task list clean.**",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The task ID to update."
      },
      status: {
        type: "string",
        enum: ["pending", "in-progress", "complete"],
        description: "New status for the task."
      }
    },
    required: ["id", "status"]
  }
};

export const LIST_TASKS_TOOL: any = {
  name: "list_tasks",
  description: "List tasks, optionally filtered by conversation ID or status. Use this to view your current task checklist.",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: {
        type: "string",
        description: "Optional conversation ID to filter tasks. If null, shows global tasks. If '__all__', shows all tasks."
      },
      status: {
        type: "string",
        enum: ["pending", "in-progress", "complete"],
        description: "Optional status filter."
      }
    }
  }
};

export const DELETE_TASK_TOOL: any = {
  name: "delete_task",
  description: "Delete a task from the task list. Use this to remove outdated or completed tasks to prevent clutter.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The task ID to delete."
      }
    },
    required: ["id"]
  }
};



export const DELETE_RELATION_TOOL: any = {
  name: "delete_relation",
  description: "Delete a relationship link between two entities. Use this to cleanup incorrect connections.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "The name of the source entity." },
      target: { type: "string", description: "The name of the target entity." },
      relation: { type: "string", description: "The verb describing the relationship (e.g., 'uses', 'is_not')." }
    },
    required: ["source", "target", "relation"]
  }
};

export const DELETE_ENTITY_TOOL: any = {
  name: "delete_entity",
  description: "Delete an entity and all its relations. Use this to remove incorrect or duplicate entities (like 'NOT').",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The name of the entity to delete." }
    },
    required: ["name"]
  }
};

export const UPDATE_ENTITY_TOOL: any = {
  name: "update_entity",
  description: "Update an entity's name or type.",
  inputSchema: {
    type: "object",
    properties: {
        current_name: { type: "string", description: "The current name of the entity." },
        new_name: { type: "string", description: "The new name (optional)." },
        new_type: { type: "string", description: "The new type (optional)." }
    },
    required: ["current_name"]
  }
}; // New tools added
