import { useTranslation } from "react-i18next";
import type { ExecutorSnapshot, RuntimeBinding } from "@/lib/deliveryTeamRuntime";
import "./delivery-team-runtime.css";
export function RuntimeBindingFacts({ binding }: { binding: RuntimeBinding }) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryTeamRuntime.${key}`);
  return <dl className="team-runtime-facts"><div><dt>{tr("workspace")}</dt><dd>{binding.source.workspace_name}<code>{binding.workspace_id}</code></dd></div><div><dt>{tr("profile")}</dt><dd>{binding.source.agent_title}<code>{binding.agent_id} · v{binding.agent_version} · {binding.source.provider}</code></dd></div></dl>;
}
export function ExecutionExecutorFacts({ snapshot }: { snapshot: ExecutorSnapshot | null | undefined }) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryTeamRuntime.${key}`);
  if (!snapshot) return <p className="runtime-help">{tr(snapshot === null ? "noAssociation" : "unrecorded")}</p>;
  return <section className="team-runtime-executor" aria-label={tr("snapshotTitle")}><strong>{tr("snapshotTitle")}</strong><dl className="team-runtime-facts"><div><dt>{tr("member")}</dt><dd>{snapshot.member_name}<code>{snapshot.member_id}</code></dd></div><div><dt>{tr("profile")}</dt><dd>{snapshot.workspace_name} / {snapshot.agent_title}<code>{snapshot.workspace_id} / {snapshot.agent_id} · v{snapshot.agent_version} · {snapshot.provider}</code></dd></div><div><dt>{tr("generation")}</dt><dd>{snapshot.binding_generation}</dd></div><div><dt>{tr("recorded")}</dt><dd>{snapshot.recorded_at}<code>{snapshot.recorded_by}</code></dd></div></dl></section>;
}
