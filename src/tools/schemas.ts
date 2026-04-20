import { z } from "zod";

export const CliArgsSchema = z.object({
    command: z.string()
});

export const RememberFactArgsSchema = z.object({
    text: z.string(),
    tags: z.array(z.string()).optional()
});

export const RememberFactsArgsSchema = z.object({
    facts: z.array(z.object({
        text: z.string(),
        tags: z.array(z.string()).optional()
    }))
});

export const RecallArgsSchema = z.object({
    query: z.string(),
    limit: z.number().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    json: z.boolean().optional(),
    debug: z.boolean().optional()
});

export const ForgetArgsSchema = z.object({
    memory_id: z.string()
});

export const ListRecentMemoriesArgsSchema = z.object({
    limit: z.number().optional(),
    json: z.boolean().optional()
});

export const ExportMemoriesArgsSchema = z.object({
    path: z.string()
});

export const CreateEntityArgsSchema = z.object({
    name: z.string(),
    type: z.string(),
    observations: z.array(z.string()).optional()
});

export const CreateRelationArgsSchema = z.object({
    source: z.string(),
    target: z.string(),
    relation: z.string(),
    depth: z.number().min(1).max(3).optional()
});

export const ReadGraphArgsSchema = z.object({
    center: z.string().optional(),
    depth: z.number().optional(),
    json: z.boolean().optional()
});

export const ClusterMemoriesArgsSchema = z.object({
    k: z.number().optional()
});

export const ConsolidateContextArgsSchema = z.object({
    text: z.string(),
    strategy: z.enum(["nlp", "llm"]).optional(),
    limit: z.number().optional()
});

export const DeleteObservationArgsSchema = z.object({
    entity_name: z.string(),
    observations: z.array(z.string())
});

export const AddTodoArgsSchema = z.object({
    content: z.string(),
    due_date: z.string().optional()
});

export const CompleteTodoArgsSchema = z.object({
    id: z.string()
});

export const ListTodosArgsSchema = z.object({
    status: z.enum(["pending", "completed"]).optional(),
    limit: z.number().optional()
});

export const InitConversationArgsSchema = z.object({
    name: z.string().optional()
});

export const AddTaskArgsSchema = z.object({
    content: z.string(),
    section: z.string().optional(),
    conversation_id: z.string().optional()
});

export const UpdateTaskStatusArgsSchema = z.object({
    id: z.string(),
    status: z.enum(["pending", "in-progress", "complete"])
});

export const ListTasksArgsSchema = z.object({
    conversation_id: z.string().optional(),
    status: z.enum(["pending", "in-progress", "complete"]).optional()
});

export const DeleteTaskArgsSchema = z.object({
    id: z.string()
});

export const DeleteRelationArgsSchema = z.object({
    source: z.string(),
    target: z.string(),
    relation: z.string()
});

export const DeleteEntityArgsSchema = z.object({
    name: z.string()
});

export const UpdateEntityArgsSchema = z.object({
    current_name: z.string(),
    new_name: z.string().optional(),
    new_type: z.string().optional()
});
