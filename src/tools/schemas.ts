import { z } from "zod";

export const CliArgsSchema = z.object({
    command: z.string().trim().min(1).max(20_000)
});

export const RememberFactArgsSchema = z.object({
    text: z.string().trim().min(1).max(100_000),
    tags: z.array(z.string().trim().min(1).max(200)).max(100).optional()
});

export const RememberFactsArgsSchema = z.object({
    facts: z.array(z.object({
        text: z.string().trim().min(1).max(100_000),
        tags: z.array(z.string().trim().min(1).max(200)).max(100).optional()
    })).min(1).max(1_000)
});

export const RecallArgsSchema = z.object({
    query: z.string().trim().min(1).max(20_000),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    json: z.coerce.boolean().optional(),
    debug: z.coerce.boolean().optional(),
    include_outdated: z.coerce.boolean().optional()
});

export const ReinforceMemoryArgsSchema = z.object({
    memory_id: z.string().uuid(),
    signal: z.enum([
        "used",
        "important",
        "irrelevant",
        "incorrect",
        "outdated",
        "restore"
    ]),
    reason: z.string().trim().min(1).max(1_000).optional()
});

export const ForgetArgsSchema = z.object({
    memory_id: z.string()
});

export const ListRecentMemoriesArgsSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    json: z.coerce.boolean().optional()
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
    depth: z.coerce.number().min(1).max(3).optional()
});

export const ReadGraphArgsSchema = z.object({
    center: z.string().optional(),
    depth: z.coerce.number().int().min(1).max(10).optional(),
    json: z.coerce.boolean().optional()
});

export const ClusterMemoriesArgsSchema = z.object({
    k: z.coerce.number().int().min(1).max(100).optional()
});

export const ConsolidateContextArgsSchema = z.object({
    text: z.string(),
    strategy: z.enum(["nlp", "llm"]).optional(),
    limit: z.coerce.number().int().min(1).max(1_000).optional()
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
    limit: z.coerce.number().int().min(1).max(100).optional()
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
