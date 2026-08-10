import type { ProposedTask } from "../../state/types";

export type JsonSchema = {
    type: ("object" | "array" | "string" | "number" | "integer" | "boolean" | "null") | readonly ("object" | "array" | "string" | "number" | "integer" | "boolean" | "null")[];
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: JsonSchema;
    enum?: readonly unknown[];
    minLength?: number;
    minimum?: number;
};

export interface SchemaValidationIssue {
    path: string;
    message: string;
}

const taskStatus = ["Backlog", "Next", "In Progress", "Blocked", "Done"] as const;
const taskPriority = ["Low", "Medium", "High"] as const;

const checklistItemSchema: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["id", "title", "done"],
    properties: {
        id: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1 },
        done: { type: "boolean" },
    },
};

const plannerTaskSchema: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "status", "priority", "checklist", "relatedTo"],
    properties: {
        id: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1 },
        projectId: { type: ["string", "null"] },
        status: { type: "string", enum: taskStatus },
        priority: { type: "string", enum: taskPriority },
        dueDate: { type: "string", minLength: 1 },
        estimatePomos: { type: "integer", minimum: 1 },
        description: { type: "string" },
        checklist: { type: "array", items: checklistItemSchema },
        relatedTo: { type: "array", items: { type: "string", minLength: 1 } },
        splitsFrom: { type: "string", minLength: 1 },
        rationale: { type: "string", minLength: 1 },
        estimateEvidenceTaskIds: { type: "array", items: { type: "string", minLength: 1 } },
    },
};

const writerTaskSchema: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "description", "checklist"],
    properties: {
        id: { type: "string", minLength: 1 },
        title: { type: "string", minLength: 1 },
        description: { type: "string" },
        checklist: { type: "array", items: checklistItemSchema },
    },
};

export const plannerOutputSchema: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "proposedTasks"],
    properties: {
        summary: { type: "string", minLength: 1 },
        proposedTasks: { type: "array", items: plannerTaskSchema },
    },
};

export const writerOutputSchema: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "proposedTasks"],
    properties: {
        summary: { type: "string", minLength: 1 },
        proposedTasks: { type: "array", items: writerTaskSchema },
    },
};

export type PlannerTaskOutput = ProposedTask;

export interface PlannerOutput {
    summary: string;
    proposedTasks: PlannerTaskOutput[];
}

export interface WriterTaskOutput {
    id?: string;
    title: string;
    description: string;
    checklist: { id: string; title: string; done: boolean }[];
}

export interface WriterOutput {
    summary: string;
    proposedTasks: WriterTaskOutput[];
}

function typeMatches(value: unknown, type: JsonSchema["type"]): boolean {
    if (Array.isArray(type)) return type.some((item) => typeMatches(value, item));
    if (type === "null") return value === null;
    if (type === "array") return Array.isArray(value);
    if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
    if (type === "integer") return typeof value === "number" && Number.isInteger(value);
    return typeof value === type;
}

function validate(value: unknown, schema: JsonSchema, path: string, issues: SchemaValidationIssue[]): void {
    if (!typeMatches(value, schema.type)) {
        issues.push({ path, message: `must be ${Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type}` });
        return;
    }
    if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
        issues.push({ path, message: `must be one of ${schema.enum.join(", ")}` });
    }
    if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) {
        issues.push({ path, message: `must contain at least ${schema.minLength} character(s)` });
    }
    if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
        issues.push({ path, message: `must be at least ${schema.minimum}` });
    }
    if (schema.type === "array" && schema.items) {
        (value as unknown[]).forEach((item, index) => validate(item, schema.items as JsonSchema, `${path}[${index}]`, issues));
    }
    if (schema.type !== "object") return;

    const object = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
        if (!(required in object)) issues.push({ path, message: `is missing required property "${required}"` });
    }
    if (schema.additionalProperties === false) {
        for (const key of Object.keys(object)) {
            if (!schema.properties?.[key]) issues.push({ path: `${path}.${key}`, message: "is not allowed" });
        }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
        if (key in object) validate(object[key], propertySchema, `${path}.${key}`, issues);
    }
}

export function validateJsonAgainstSchema(value: unknown, schema: JsonSchema): SchemaValidationIssue[] {
    const issues: SchemaValidationIssue[] = [];
    validate(value, schema, "$", issues);
    return issues;
}

export function parseStrictJson<T>(content: string, schema: JsonSchema): T {
    let value: unknown;
    try {
        value = JSON.parse(content);
    } catch {
        throw new Error("response is not valid JSON");
    }
    const issues = validateJsonAgainstSchema(value, schema);
    if (issues.length > 0) {
        throw new Error(issues.map((issue) => `${issue.path} ${issue.message}`).join("; "));
    }
    return value as T;
}
