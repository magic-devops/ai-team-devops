import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryTask } from "@/lib/delivery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { taskRecordStatusLabel } from "@/lib/deliveryTaskReview";
import { taskDetailNavigationCopy } from "@/i18n/task-detail-navigation";
import { focusTaskSection, taskDetailNextSection, taskDetailSections, type TaskDetailSection } from "@/lib/taskDetailNavigation";
import "./task-detail-workspace.css";

export function TaskDetailNavigation({ task, onNavigate }: { task?: DeliveryTask; onNavigate: (section: TaskDetailSection) => void }) {
  const { i18n } = useTranslation(), copy = taskDetailNavigationCopy(i18n?.language);
  return <nav className="task-detail-navigation" aria-label={copy.navigation}>
    {taskDetailSections.map((section) => <button type="button" key={section} data-task-jump={section}
      disabled={!task && ["overview", "execution", "planning", "discussion"].includes(section)} onClick={() => onNavigate(section)}>
      {copy.sections[section]}
    </button>)}
  </nav>;
}

/** Reading position changes preserve every editor and recovery owner below. */
export function TaskDetailWorkspace({ scope, task, frozen = false, isActive, children }: {
  scope: string; task?: DeliveryTask; frozen?: boolean; isActive: () => boolean; children: ReactNode;
}) {
  const { t, i18n } = useTranslation(), copy = taskDetailNavigationCopy(i18n?.language);
  const root = useRef<HTMLDivElement>(null), owner = useRef(projectSessionKey()), mounted = useRef(true);
  const live = useRef({ scope, isActive }); live.current = { scope, isActive };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && owner.current === projectSessionKey() && live.current.scope === scope && live.current.isActive();
  const readable = current() ? task : undefined;
  const navigate = (section: TaskDetailSection) => { focusTaskSection(root.current, section, current); };
  const next = readable && !frozen ? taskDetailNextSection(readable) : null;
  const accepted = readable?.verified && readable.delivery_status === "verified_completed";
  const effective = readable && (readable.delivery_status !== "verified_completed" || accepted) && ["pending", "in_progress", "blocked", "awaiting_review", "recorded_completed", "verified_completed"].includes(readable.delivery_status)
    ? t(`deliveryProgress.states.${readable.delivery_status}`) : copy.unknown;
  return <div ref={root} className="delivery-task-detail task-detail-workspace">
    <header className="task-detail-toolbar" aria-label={copy.title}>
      <TaskDetailNavigation task={readable} onNavigate={navigate} />
      {readable ? <>
        <dl className="task-detail-status-facts">
          <div><dt>{copy.record}</dt><dd>{taskRecordStatusLabel(readable.recorded_status || readable.status, t)}</dd></div>
          <div data-accepted={accepted ? "true" : "false"}><dt>{frozen ? copy.snapshotEffective : copy.effective}</dt><dd>{effective}</dd></div>
        </dl>
        <div className="task-detail-next">
          {frozen ? <span>{copy.frozen}</span> : accepted ? <span>{copy.complete}</span> : <>
            {(readable.recorded_status || readable.status) === "completed" && <span>{copy.unverified}</span>}
            {next && <button type="button" onClick={() => navigate(next)}>{copy.next} · {copy.sections[next]} <span aria-hidden="true">↓</span></button>}
          </>}
        </div>
      </> : <p className="task-detail-read-notice" role="status">{copy.unavailable}</p>}
    </header>
    {children}
  </div>;
}
