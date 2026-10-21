import { useRef, useState } from "react";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { executionControlRecoveryPending } from "@/lib/executionControlCommand";
import { executionDispatchRecoveryPending } from "@/lib/executionDispatchCommand";
import { executionReviewRecoveryPending } from "@/lib/executionReviewCommand";
import { ExecutionRuntimeControl } from "./ExecutionRuntimeControl";
import { ExecutionSyncControl } from "./ExecutionSyncControl";
import { ExecutionReviewControl } from "./ExecutionReviewControl";

export function executionOperationPending(projectId: string, executionId: string) {
  return executionControlRecoveryPending(projectId, executionId) || executionDispatchRecoveryPending(projectId, "execution.sync", executionId) || executionReviewRecoveryPending(projectId, executionId);
}
/** Recover one original at a time, independently of a fresh detail/runtime read. */
export function ExecutionOperationRecovery({ projectId, executionId, sessionId, isActive, onSaved, onUnresolvedChange }: {
  projectId: string; executionId: string; sessionId: string; isActive?: () => boolean;
  onSaved: (ack: DeliveryCommandAck) => void; onUnresolvedChange?: (value: boolean) => void;
}) {
  const choose = () => executionControlRecoveryPending(projectId, executionId) ? "runtime" as const :
    executionDispatchRecoveryPending(projectId, "execution.sync", executionId) ? "sync" as const :
    executionReviewRecoveryPending(projectId, executionId) ? "review" as const : null;
  const [selected, setSelected] = useState(choose), active = useRef(selected);
  active.current = selected;
  const pending = (value: boolean) => {
    const next = choose();
    onUnresolvedChange?.(value || Boolean(next));
    if (!value) setSelected(next);
  };
  return selected === "runtime" ? <ExecutionRuntimeControl projectId={projectId} executionId={executionId} sessionId={sessionId}
    disabled isActive={() => active.current === "runtime" && isActive?.() !== false} onSaved={onSaved} onObserved={() => {}} onUnresolvedChange={pending} /> :
    selected === "sync" ? <ExecutionSyncControl projectId={projectId} executionId={executionId} sessionId={sessionId}
      disabled isActive={() => active.current === "sync" && isActive?.() !== false} onSaved={onSaved} onUnresolvedChange={pending} /> :
    selected === "review" ? <ExecutionReviewControl projectId={projectId} executionId={executionId} sessionId={sessionId}
      disabled isActive={() => active.current === "review" && isActive?.() !== false} onSaved={onSaved} onUnresolvedChange={pending} /> : null;
}
