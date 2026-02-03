import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// We'll use Zod for validation but export standard CallToolRequest schema structures/names if needed
// Or just export the helper objects to register tools easily.

export const REMEMBER_FACT_TOOL: any = {
  name: "remember_fact",
  description: "Save an important fact or piece of information to long-term memory. Use this when the user tells you something worth remembering for future sessions.",
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

export const READ_GRAPH_TOOL: any = {
  name: "read_graph",
  description: "Explore the knowledge graph. Use this to see how entities are connected or to get a summary of everything known about a specific entity.",
  inputSchema: {
    type: "object",
    properties: {
      center: { type: "string", description: "Optionally focus on a specific entity. If omitted, returns a general overview of the graph." },
      depth: { type: "number", description: "How many levels of connections to traverse (default 1)." }
    }
  }
};

export const CLUSTER_MEMORIES_TOOL: any = {
  name: "cluster_memories",
  description: "Cluster memories into topics. Useful for getting a high-level overview of what knowledge is stored.",
  inputSchema: {
    type: "object",
    properties: {
      k: { type: "number", description: "Number of topics to generate (default 5)." }
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

