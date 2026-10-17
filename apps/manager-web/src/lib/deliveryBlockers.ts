/** Translate known projection messages while preserving recorded user content. */
export function deliveryBlocker(
  reason: string,
  translate: (key: string, values?: Record<string, string>) => string,
) {
  if (reason === "Task is blocked") return translate("task");
  const dependency = /^Dependency not complete: (.+)$/.exec(reason);
  if (dependency) return translate("dependency", { id: dependency[1] });
  const issue = /^Unresolved issue (\S+): ([\s\S]*)$/.exec(reason);
  if (issue) return translate("issue", { id: issue[1], title: issue[2] });
  return reason;
}
