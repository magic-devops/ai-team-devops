import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Skeleton, Tag } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryMember, DeliveryCommandAck } from "@/lib/delivery";
import {
  fetchTeamRuntimeBindings,
  openRuntimeBindingDraft,
  type RuntimeBindingDraft,
} from "@/lib/deliveryTeamRuntime";
import { RuntimeBindingFacts } from "./ExecutionExecutorFacts";
import { MemberRuntimeBindingEditor } from "./MemberRuntimeBindingEditor";
import "./delivery-team-runtime.css";

export function DeliveryMemberRuntime({
  member,
  projectId,
  sessionId,
  onSaved,
}: {
  member: DeliveryMember;
  projectId: string;
  sessionId: string;
  onSaved: (workspace: DeliveryCommandAck) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryTeamRuntime.${key}`);
  const qc = useQueryClient();
  const key = ["delivery-team-runtime", projectId, sessionId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchTeamRuntimeBindings(projectId, signal),
    enabled: member.kind === "agent",
    retry: false,
    gcTime: 0,
    refetchInterval: 15000,
  });
  const [draft, setDraft] = useState<RuntimeBindingDraft>();
  const [initialCatalogue, setInitialCatalogue] = useState(query.data);
  const row = query.data?.members.find((item) => item.member_id === member.id);
  if (member.kind !== "agent") return null;
  const edit = (operation: RuntimeBindingDraft["operation"]) => {
    if (!query.data) return;
    setInitialCatalogue(structuredClone(query.data));
    setDraft(
      openRuntimeBindingDraft(
        query.data,
        member.id,
        operation,
        crypto.randomUUID(),
      ),
    );
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
                disabled={query.isError}
                onClick={() => edit("bind")}
              >
                {tr(row.binding ? "update" : "bind")}
              </Button>
            )}
            {row.permissions.can_unbind && (
              <Button
                size="small"
                disabled={query.isError}
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
          onClose={() => setDraft(undefined)}
          onSaved={(workspace) => {
            onSaved(workspace);
            void qc.invalidateQueries({
              queryKey: ["delivery-team-runtime", projectId],
            });
            void qc.invalidateQueries({
              queryKey: ["delivery-targets", projectId],
            });
          }}
        />
      )}
    </section>
  );
}
