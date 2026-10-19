import { currentDiscussionHash } from "@/lib/deliveryDiscussionNavigation";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Modal, Select, Skeleton } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  prepareDeliveryIntent,
  saveDelivery,
  type DeliveryIntent,
  type DeliveryCommandAck,
} from "@/lib/delivery";
import {
  fetchDeliveryContext,
  fetchDeliveryTaskEditData,
  fetchEditableRequirement,
  fetchTaskDetail,
} from "@/lib/deliveryQuery";
import { fetchDeliveryIssue, type IssueDetail } from "@/lib/deliveryIssue";
import {
  discussionFailure,
  type DiscussionAdoption,
  type DiscussionScope,
} from "@/lib/deliveryDiscussions";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { requirementAdoptionHref } from "@/lib/deliveryRequirementAdoption";
import { DeliveryTaskPlanEditor } from "./DeliveryTaskPlanEditor";
import { DeliveryTaskPlanMaintenance } from "./DeliveryTaskPlanMaintenance";
import { IssueReviewPanel } from "./DeliveryIssueReview";
import { DeliveryEditor, type EditorSpec } from "./DeliveryEditor";
import {
  DiscussionAdoptionSource,
  useDiscussionAdoptionSource,
} from "./DeliveryDiscussionAdoptionSource";
import {
  DeliveryDiscussionPanel,
  DeliveryObjectCollaboration,
} from "./DeliveryDiscussionPanel";
import { DiscussionProblem } from "./DeliveryDiscussionCommon";
import { useDiscussionNavigation } from "./DeliverySourceSummary";
import type { DiscussionAdoptAction } from "./DeliveryDiscussionThread";

export async function loadDiscussionAdoption(
  projectId: string,
  action: Exclude<DiscussionAdoptAction, "requirement">,
  source: DiscussionAdoption,
  signal?: AbortSignal,
) {
  const subject = source.thread.subject;
  if (subject.missing) throw new Error("discussion_subject_missing");
  const context = await fetchDeliveryContext(projectId, signal);
  if (context.project_id !== projectId || !context.permissions.write)
    throw new Error("HTTP 403: discussion adoption forbidden");
  if (action === "task") {
    if (subject.kind !== "task") throw new Error("discussion_scope_changed");
    const task = await fetchDeliveryTaskEditData(projectId, subject.id, signal);
    if (task.project.id !== projectId || task.task.id !== subject.id)
      throw new Error("discussion_scope_changed");
    return { context, task };
  }
  if (action === "issue" || action === "diagnosis") {
    if (subject.kind !== "issue") throw new Error("discussion_scope_changed");
    const issue = await fetchDeliveryIssue(projectId, subject.id, signal);
    if (issue.project_id !== projectId || issue.issue.id !== subject.id)
      throw new Error("discussion_scope_changed");
    return { context, issue };
  }
  let requirementId = subject.id;
  if (subject.kind === "task" && action === "plan") {
    const current = await fetchTaskDetail(projectId, subject.id, signal);
    if (
      current.project_id !== projectId ||
      current.task.id !== subject.id ||
      !current.task.req_id
    )
      throw new Error("discussion_subject_missing");
    requirementId = current.task.req_id;
  } else if (subject.kind !== "requirement")
    throw new Error("discussion_scope_changed");
  const requirement = await fetchEditableRequirement(
    projectId,
    requirementId,
    signal,
  );
  if (
    requirement.project_id !== projectId ||
    requirement.requirement.id !== requirementId
  )
    throw new Error("discussion_scope_changed");
  return { context, requirement };
}
function IssuePromotion({
  projectId,
  detail,
  initialSource,
  onSaved,
  onClose,
  onUnresolvedChange,
}: {
  projectId: string;
  detail: IssueDetail;
  initialSource: DiscussionAdoption;
  onSaved: (ack: DeliveryCommandAck) => void;
  onClose: () => void;
  onUnresolvedChange?: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const source = useDiscussionAdoptionSource(initialSource),
    origin = useRef(projectSessionKey());
  const nav = useDiscussionNavigation(`promotion:${detail.issue.id}`);
  const [spec] = useState<EditorSpec>(() => {
    let pinned = detail;
    let latest: IssueDetail | undefined;
    let intent: DeliveryIntent = {
      version: detail.version,
      key: crypto.randomUUID(),
    };
    return {
      title: t("deliveryDiscussion.adoptIssue"),
      hint: t("deliveryDiscussion.issuePromotionHint"),
      values: { acceptance_criteria: [initialSource.message.body || ""] },
      fields: [
        {
          key: "acceptance_criteria",
          label: t("deliveryDiscussion.acceptance_criteria"),
          type: "criteria",
        },
      ],
      submit: async (values) => {
        if (origin.current !== projectSessionKey())
          throw new Error("scopeChanged");
        const payload = {
          issue_id: pinned.issue.id,
          acceptance_criteria: values.acceptance_criteria,
        };
        const reference = source.current.current?.reference;
        intent = prepareDeliveryIntent(
          intent,
          "issue.promote",
          payload,
          reference,
        );
        try {
          const ack = await saveDelivery(
            projectId,
            "issue.promote",
            payload,
            intent.version,
            intent.key,
            reference,
          );
          if (origin.current === projectSessionKey()) onSaved(ack);
        } catch (error) {
          if (discussionFailure(error).conflict) {
            const conflict = new Error(t("deliveryDiscussion.conflict"));
            conflict.name = "DeliveryConflict";
            throw conflict;
          }
          throw error;
        }
      },
      loadLatest: async () => {
        latest = await fetchDeliveryIssue(projectId, detail.issue.id);
        return {
          version: latest.version,
          items: [
            {
              label: t("deliveryDiscussion.titleField"),
              value: latest.issue.title,
            },
            {
              label: t("deliveryDiscussion.description"),
              value: latest.issue.description,
            },
          ],
        };
      },
      adoptVersion: (version) => {
        if (latest) {
          pinned = latest;
          intent = { version, key: crypto.randomUUID() };
        }
      },
    };
  });
  if (detail.requirement_id)
    return (
      <Modal
        open
        footer={null}
        onCancel={onClose}
        title={t("deliveryDiscussion.adoptIssue")}
      >
        <Alert type="info" title={t("deliveryIssue.existingRequirement")} />
        <Button
          loading={Boolean(nav.busy)}
          onClick={() =>
            void nav.open(projectId, {
              kind: "requirement",
              id: detail.requirement_id!,
            })
          }
        >
          {t("deliveryIssue.openRequirement")}
        </Button>
        {Boolean(nav.error) && <DiscussionProblem error={nav.error} />}
      </Modal>
    );
  return (
    <DeliveryEditor
      spec={spec}
      sourceAware
      header={(blocked) => (
        <>
          <h4>{detail.issue.title}</h4>
          <p className="discussion-text">{detail.issue.description}</p>
          <DiscussionAdoptionSource
            projectId={projectId}
            source={source}
            disabled={blocked}
          />
        </>
      )}
      onClose={onClose}
      onUnresolvedChange={onUnresolvedChange}
    />
  );
}
export function DeliveryDiscussionAdoption({
  projectId,
  sessionId,
  action,
  source,
  onClose,
  onSaved,
  onUnresolvedChange,
}: {
  projectId: string;
  sessionId: string;
  action: Exclude<DiscussionAdoptAction, "requirement">;
  source: DiscussionAdoption;
  onClose: () => void;
  onSaved: (ack: DeliveryCommandAck) => void;
  onUnresolvedChange?: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const [unresolved, setUnresolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = busy || unresolved;
  const [diagnosisId, setDiagnosisId] = useState("");
  const session = projectSessionKey();
  const query = useQuery({
    queryKey: [
      "discussion-adoption",
      projectId,
      sessionId,
      session,
      action,
      source.reference,
    ],
    queryFn: ({ signal }) =>
      loadDiscussionAdoption(projectId, action, source, signal),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const data = !query.error ? query.data : undefined;
  const pending = (value: boolean) => {
    setUnresolved(value);
    onUnresolvedChange?.(value);
  };
  if (query.isPending || query.error || !data)
    return (
      <Modal
        open
        footer={null}
        onCancel={onClose}
        title={t("deliveryDiscussion.adoptHint")}
      >
        {query.isPending ? (
          <Skeleton active />
        ) : (
          <DiscussionProblem
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        )}
      </Modal>
    );
  if (action === "plan" && data.requirement)
    return (
      <DeliveryTaskPlanEditor
        data={data.context}
        requirement={data.requirement.requirement}
        requirementVersion={data.requirement.version}
        onSaved={onSaved}
        onClose={onClose}
        initialSource={source}
        onUnresolvedChange={pending}
      />
    );
  if (action === "task" && data.task)
    return (
      <DeliveryTaskPlanMaintenance
        task={data.task.task}
        data={data.task}
        canEdit
        onTask={() => {}}
        onSaved={onSaved}
        initialSource={source}
        onClose={onClose}
        onUnresolvedChange={pending}
      />
    );
  if (action === "issue" && data.issue)
    return (
      <IssuePromotion
        projectId={projectId}
        detail={data.issue}
        initialSource={source}
        onSaved={onSaved}
        onClose={onClose}
        onUnresolvedChange={pending}
      />
    );
  const selected = data.issue?.diagnoses.find(
    (item) => item.id === diagnosisId,
  );
  return (
    <Modal
      open
      footer={null}
      width={760}
      onCancel={() => !locked && onClose()}
      maskClosable={!locked}
      keyboard={!locked}
      closable={!locked}
      title={t("deliveryDiscussion.adoptDiagnosis")}
    >
      <Select
        aria-label={t("deliveryDiscussion.chooseDiagnosis")}
        disabled={locked}
        value={diagnosisId || undefined}
        options={data.issue?.diagnoses.map((item) => ({
          value: item.id,
          label: `${item.created_at} · ${item.status}`,
        }))}
        onChange={setDiagnosisId}
      />
      {selected && data.issue ? (
        <IssueReviewPanel
          key={selected.id}
          projectId={projectId}
          detail={data.issue}
          diagnosis={selected}
          background={currentDiscussionHash()}
          readOnly={!data.context.permissions.write}
          onSaved={onSaved}
          initialSource={source}
          onBusyChange={setBusy}
          onUnresolvedChange={pending}
        />
      ) : (
        <Alert type="info" title={t("deliveryDiscussion.chooseDiagnosis")} />
      )}
    </Modal>
  );
}
export function DeliveryCollaboration({
  projectId,
  sessionId,
  subject,
  object = false,
  readOnly = false,
  onSaved,
  onUnresolvedChange,
  onNavigate,
}: {
  projectId: string;
  sessionId: string;
  subject?: DiscussionScope;
  object?: boolean;
  readOnly?: boolean;
  onSaved: (ack: DeliveryCommandAck) => void;
  onUnresolvedChange?: (value: boolean) => void;
  onNavigate?: (href: string) => void;
}) {
  const [adoption, setAdoption] = useState<{
    action: Exclude<DiscussionAdoptAction, "requirement">;
    source: DiscussionAdoption;
  } | null>(null);
  const origin = useRef(projectSessionKey());
  const props = {
    projectId,
    sessionId,
    subject,
    readOnly,
    onNavigate,
    onUnresolvedChange,
    onAdopt: (action: DiscussionAdoptAction, source: DiscussionAdoption) => {
      if (action === "requirement") {
        const href = requirementAdoptionHref(
          projectId,
          source,
          currentDiscussionHash(),
        );
        if (onNavigate) onNavigate(href);
        else location.hash = href;
        return;
      }
      setAdoption({ action, source });
    },
  };
  return (
    <>
      {object && subject ? (
        <DeliveryObjectCollaboration {...props} subject={subject} />
      ) : (
        <DeliveryDiscussionPanel {...props} />
      )}{" "}
      {adoption && (
        <DeliveryDiscussionAdoption
          key={`${projectId}:${sessionId}:${JSON.stringify(adoption.source.reference)}:${adoption.source.field}:${adoption.action}`}
          projectId={projectId}
          sessionId={sessionId}
          {...adoption}
          onClose={() => setAdoption(null)}
          onUnresolvedChange={onUnresolvedChange}
          onSaved={(ack) => {
            if (
              origin.current !== projectSessionKey() ||
              ack.project_id !== projectId
            )
              return;
            onSaved(ack);
          }}
        />
      )}
    </>
  );
}
