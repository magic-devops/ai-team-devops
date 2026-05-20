export type DataDevScheduleForm = {
  selectedIds: string[];
  dryRun: boolean;
  maxParallel: number;
  policy: string;
  priority: string;
  assignedTo: string;
  devTool: string;
};

export type DataDevSchedulePayload = {
  ids: string[];
  dry_run: boolean;
  max_parallel: number;
  policy: string;
  priority: string;
  assigned_to: string;
  dev_tool: string;
  event: string;
};

export type DataDevPacket = {
  ready?: boolean;
  claim?: unknown;
  report?: unknown;
};

export function toggleTemplateSelection(selectedIds: string[], id: string): string[] {
  if (selectedIds.includes(id)) return selectedIds.filter((item) => item !== id);
  return [...selectedIds, id];
}

export function buildSchedulePayload(form: DataDevScheduleForm): DataDevSchedulePayload {
  return {
    ids: form.selectedIds,
    dry_run: form.dryRun,
    max_parallel: form.maxParallel,
    policy: form.policy,
    priority: form.priority,
    assigned_to: form.assignedTo,
    dev_tool: form.devTool,
    event: "manager-web:data-development",
  };
}

export function derivePacketStats(items: DataDevPacket[]) {
  return items.reduce(
    (acc, item) => {
      if (item.ready) acc.ready += 1;
      else acc.blocked += 1;
      if (item.claim) acc.claimed += 1;
      if (item.report) acc.reported += 1;
      return acc;
    },
    { ready: 0, blocked: 0, claimed: 0, reported: 0 },
  );
}
