export type Turn = { ts: string; sessionId: string; runId: string; query: string; response?: unknown; error?: string };
export type CopilotMode = "chat" | "commands" | "tool-plan";
export type CommandTypeFilter = "all" | "navigate" | "operation" | "copilot";
export type CommandCandidate = { id?: string; label?: string; description?: string; type?: string; target?: string; prompt?: string };
export type QuickPrompt = { label: string; prompt: string };
export type PlanTemplate = { label: string; prompt: string };
