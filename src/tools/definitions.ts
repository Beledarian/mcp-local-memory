import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// We'll use Zod for validation but export standard CallToolRequest schema structures/names if needed
// Or just export the helper objects to register tools easily.

export const REMEMBER_FACT_TOOL: any = {
  name: "remember_fact",
  description: "Save a piece of information or fact to memory.",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The content of the fact to remember."
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Optional tags to categorize the memory."
      }
    },
    required: ["text"]
  }
};

export const RECALL_TOOL: any = {
  name: "recall",
  description: "Search for passed memories. Uses semantic search if available, falls back to full-text search.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query."
      },
      limit: {
        type: "number",
        description: "Max number of results to return (default 5)."
      }
    },
    required: ["query"]
  }
};

export const FORGET_TOOL: any = {
  name: "forget",
  description: "Delete a specific memory by ID.",
  inputSchema: {
    type: "object",
    properties: {
      memory_id: {
        type: "string",
        description: "The ID of the memory to delete."
      }
    },
    required: ["memory_id"]
  }
};

export const LIST_RECENT_MEMORIES_TOOL: any = {
  name: "list_recent_memories",
  description: "List the most recently added memories.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Number of memories to retrieve (default 10)."
      }
    }
  }
};

export const EXPORT_MEMORIES_TOOL: any = {
  name: "export_memories",
  description: "Export all memories to a JSON file.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path where the export JSON should be saved."
      }
    },
    required: ["path"]
  }
};
