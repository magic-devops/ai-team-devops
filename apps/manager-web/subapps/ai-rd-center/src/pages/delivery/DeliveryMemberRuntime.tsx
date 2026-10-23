import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Skeleton, Tag } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryMember, DeliveryCommandAck } from "@/lib/delivery";
import {
  fetchTeamRuntimeBindings,
  openRuntimeBindingDraft,
  type RuntimeBindingDraft,
} from "@/lib/deliveryTeamRuntime";
import { RuntimeBindingFacts } from "./ExecutionExecutorFacts";
import { MemberRuntimeBindingEditor } from "./MemberRuntimeBindingEditor";
import { RuntimeBindingRecovery } from "./RuntimeBindingRecovery";
import { useRuntimeBindingCommand, type RuntimeBindingCommand } from "@/lib/runtimeBindingCommand";
import { invalidateDeliveryQueries } from "@/lib/deliveryQuery";
import "./delivery-team-runtime.css";

export function DeliveryMemberRuntime({
  member,
  projectId,
  sessionId,
  onSaved,
  isActive,
  command,
}: {
  member: DeliveryMember;
  projectId: string;
  sessionId: string;
  onSaved: (workspace: DeliveryCommandAck) => void | Promise<void>;
  isActive?: () => boolean;
  command: RuntimeBindingCommand;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryTeamRuntime.${key}`);
  const key = ["delivery-team-runtime", projectId, sessionId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchTeamRuntimeBindings(projectId, signal),
    enabled: member.kind === "agent" || member.kind === "tool",
    retry: false,
    gcTime: 0,
    refetchInterval: 15000,
  });
  const [draft, setDraft] = useState<RuntimeBindingDraft>();
  const [initialCatalogue, setInitialCatalogue] = useState(query.data);
  const draftRef = useRef(draft); draftRef.current = draft;
  const access = useRef({ query, isActive, member }); access.current = { query, isActive, member };
  const current = () => command.current() && access.current.isActive?.() !== false;
  const canSubmit = (operation: RuntimeBindingDraft["operation"]) => {
    const latest = access.current.query;
    return current() && !latest.isError && Boolean(latest.data?.members.find((item) => item.member_id === member.id)?.permissions[operation === "bind" ? "can_bind" : "can_unbind"]) && (operation !== "bind" || access.current.member.active);
  };
  const saved = (workspace: DeliveryCommandAck) => {
    if (!current()) throw new Error("scopeChanged");
    return onSaved(workspace);
  };
  const row = query.data?.members.find((item) => item.member_id === member.id);
  if (member.kind !== "agent" && member.kind !== "tool") return null;
  const edit = (operation: RuntimeBindingDraft["operation"]) => {
    const latest = access.current.query;
    if (draftRef.current || !latest.data || !canSubmit(operation) || command.snapshot().phase !== "idle" || command.snapshot().error) return;
    setInitialCatalogue(structuredClone(latest.data));
    const next = openRuntimeBindingDraft(latest.data, member.id, operation, crypto.randomUUID());
    draftRef.current = next; setDraft(next);
  };
  return (
    <section className="team-runtime-panel" aria-label={tr("title")}>
      <div className="runtime-section-heading">
        <strong>{tr("title")}</strong>
        <Button
          size="small"
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {tr("refresh")}
        </Button>
      </div>
      <p className="runtime-help">{tr("intro")}</p>
      {member.kind === "tool" && <p className="runtime-help">{tr("toolHint")}</p>}
      {!draft && <RuntimeBindingRecovery projectId={projectId} memberId={member.id} command={command} isActive={current} onSaved={saved} />}
      {query.isPending && (
        <Skeleton active title={false} paragraph={{ rows: 2 }} />
      )}
      {query.isError && (
        <Alert
          type="warning"
          role="alert"
          title={tr(query.data ? "staleRead" : "readFailed")}
          action={
            <Button size="small" onClick={() => void query.refetch()}>
              {tr("retry")}
            </Button>
          }
        />
      )}
      {row && (
        <>
          <Tag
            color={
              !query.isError && row.status === "current"
                ? "success"
                : row.status === "stale"
                  ? "warning"
                  : undefined
            }
          >
            {tr(`states.${row.status}`)}
          </Tag>
          {row.binding ? (
            <RuntimeBindingFacts binding={row.binding} />
          ) : (
            <p className="runtime-help">{tr("empty")}</p>
          )}
          {row.reasons.length > 0 && (
            <ul className="team-runtime-reasons">
              {row.reasons.map((reason) => (
                <li key={reason.code}>
                  {t(`deliveryTeamRuntime.reasons.${reason.code}`, {
                    defaultValue: reason.message,
                  })}
                </li>
              ))}
            </ul>
          )}
          {!row.permissions.can_bind && (
            <p className="runtime-help">{tr("noPermission")}</p>
          )}
          <div className="delivery-actions">
            {row.permissions.can_bind && (
              <Button
                size="small"
                disabled={query.isError || command.state.phase !== "idle" || Boolean(command.state.error) || Boolean(draft)}
                onClick={() => edit("bind")}
              >
                {tr(row.binding ? "update" : "bind")}
              </Button>
            )}
            {row.permissions.can_unbind && (
              <Button
                size="small"
                disabled={query.isError || command.state.phase !== "idle" || Boolean(command.state.error) || Boolean(draft)}
                onClick={() => edit("unbind")}
              >
                {tr("unbind")}
              </Button>
            )}
          </div>
        </>
      )}
      {draft && initialCatalogue && (
        <MemberRuntimeBindingEditor
          key={`${projectId}:${member.id}:${draft.operation}`}
          initial={draft}
          initialCatalogue={initialCatalogue}
          memberName={member.name}
          command={command}
          canSubmit={canSubmit}
          isActive={() => current() && draftRef.current === draft}
          onClose={() => { if (current() && draftRef.current === draft) { draftRef.current = undefined; setDraft(undefined); } }}
          onSaved={saved}
        />
      )}
    </section>
  );
}

/** Own one durable operation across member-loading, missing and registered states. */
export function DeliveryMemberRuntimeOwner({ memberId, member, projectId, sessionId, onSaved, isActive }: {
  memberId: string; member?: DeliveryMember; projectId: string; sessionId: string;
  onSaved: (ack: DeliveryCommandAck) => void | Promise<void>; isActive?: () => boolean;
}) {
  const command = useRuntimeBindingCommand(projectId, memberId, sessionId);
  const qc = useQueryClient();
  const access = useRef({ command, onSaved, isActive }); access.current = { command, onSaved, isActive };
  const current = () => access.current.command.snapshot === command.snapshot && command.current() && access.current.isActive?.() !== false;
  const apply = async (ack: DeliveryCommandAck) => {
    if (!current() || ack.project_id !== projectId) throw new Error("scopeChanged");
    await access.current.onSaved(ack);
    if (!current()) throw new Error("scopeChanged");
    await invalidateDeliveryQueries(qc, projectId, { throwOnError: true, cancelRefetch: false });
    if (!current()) throw new Error("scopeChanged");
    const latest = await qc.fetchQuery({ queryKey: ["delivery-team-runtime", projectId, sessionId],
      queryFn: ({ signal }) => fetchTeamRuntimeBindings(projectId, signal), staleTime: 0 });
    if (!current() || latest.project_id !== projectId || !Number.isSafeInteger(latest.version) || latest.version < ack.applied_version) throw new Error("scopeChanged");
  };
  return member && (member.kind === "agent" || member.kind === "tool")
    ? <DeliveryMemberRuntime key={command.scope} member={member} projectId={projectId} sessionId={sessionId} command={command} onSaved={apply} isActive={isActive} />
    : <RuntimeBindingRecovery key={command.scope} projectId={projectId} memberId={memberId} command={command} onSaved={apply} isActive={isActive} />;
}
