/** 将 Copilot / NLQ 等 JSON 响应格式化为可读的 Markdown 文本 */

export function formatCopilotResponse(data: unknown): string {
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (typeof data !== "object") return String(data);

  const o = data as Record<string, unknown>;

  if (typeof o.answer === "string" && o.answer.trim()) {
    return o.answer.trim();
  }

  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (summary) {
    const lines = [summary];
    if (o.intent) lines.push("", `- **意图**: \`${String(o.intent)}\``);
    if (o.target) lines.push(`- **目标**: \`${String(o.target)}\``);
    const params = o.params;
    if (params && typeof params === "object" && Object.keys(params as object).length) {
      lines.push("", "```json", JSON.stringify(params, null, 2), "```");
    }
    return lines.join("\n");
  }

  if (typeof o.content === "string") return o.content;

  return ["```json", JSON.stringify(data, null, 2), "```"].join("\n");
}

export function buildReviewMarkdown(result: {
  score?: number;
  level?: string;
  suggestions?: string[];
  risks?: Array<{ message?: string }>;
  suggested_acceptance_criteria?: string[];
  next_actions?: string[];
}): string {
  const lines: string[] = [];
  if (result.score != null) lines.push(`## 评审得分: ${result.score}/100`);
  if (result.level) lines.push(`**等级**: ${result.level}`);
  if (result.risks?.length) {
    lines.push("", "### 风险", ...result.risks.map((r) => `- ${r.message ?? ""}`));
  }
  if (result.suggestions?.length) {
    lines.push("", "### 建议", ...result.suggestions.map((s) => `- ${s}`));
  }
  if (result.suggested_acceptance_criteria?.length) {
    lines.push("", "### 建议验收标准", ...result.suggested_acceptance_criteria.map((s) => `- ${s}`));
  }
  if (result.next_actions?.length) {
    lines.push("", "### 下一步", ...result.next_actions.map((s) => `- ${s}`));
  }
  return lines.join("\n");
}
