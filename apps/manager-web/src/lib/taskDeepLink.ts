/** A legacy task may have no requirement; its inbox link still has a stable destination. */
export function taskIdFromHash(hash: string): string {
  const query = hash.indexOf("?");
  if (query < 0) return "";
  const value = new URLSearchParams(hash.slice(query + 1)).get("task_id") || "";
  return value.length <= 64 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value) ? value : "";
}

export function linkedTaskRows<T extends { id: string }>(rows: T[], taskId: string, query: string): T[] {
  return taskId && query.trim() === taskId ? rows.filter(row => row.id === taskId) : rows;
}
