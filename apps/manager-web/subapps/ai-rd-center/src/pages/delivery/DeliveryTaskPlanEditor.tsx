import type {
  RequirementEditable,
  RequirementEditableResponse,
} from "@/lib/deliveryRequirementReads";
import {
  discussionFailure,
  type DiscussionAdoption,
} from "@/lib/deliveryDiscussions";
import {
  DiscussionAdoptionSource,
  useDiscussionAdoptionSource,
} from "./DeliveryDiscussionAdoptionSource";
import {
  fetchEditableRequirement,
  type DeliveryCommandAck,
} from "@/lib/deliveryQuery";
import { DeliveryReferenceSelect } from "@/components/DeliveryReferenceSelect";
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
} from "antd";
import { Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getToken, getWorkspaceScope } from "@/lib/authStorage";
import {
  prepareDeliveryIntent,
  saveDelivery,
  type DeliveryIntent,
  type DeliveryContext,
} from "@/lib/delivery";
import {
  planError,
  previewTaskPlan,
  remapPlanCriteria,
  selectedPlanItems,
  taskPlanProblems,
  type PlanPreviewRequest,
  type TaskPlanPreview,
  type TaskPlanRow,
} from "@/lib/deliveryTaskPlan";
import { TaskCriteriaEditor } from "./TaskCriteriaEditor";
import { ProjectOwnerSelect } from "@/components/DeliveryMemberIdentity";

type Baseline = {
  version: number;
  revision: number;
  basis?: string;
  requirement: RequirementEditable;
  workspace: DeliveryContext;
};
type Draft = {
  rows: TaskPlanRow[];
  baseline: Baseline;
  preview: TaskPlanPreview | null;
};
const scope = () => JSON.stringify([getToken(), getWorkspaceScope()]);

export function DeliveryTaskPlanEditor({
  data,
  requirement,
  requirementVersion,
  onClose,
  onSaved,
  initialSource,
  onUnresolvedChange,
}: {
  data: DeliveryContext;
  requirement: RequirementEditable;
  requirementVersion?: number;
  onClose: () => void;
  onSaved: (updated: DeliveryCommandAck) => void;
  initialSource?: DiscussionAdoption;
  onUnresolvedChange?: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, values?: Record<string, unknown>) =>
    t(`delivery.taskPlan.${key}`, values);
  const common = (key: string) => t(`delivery.${key}`);
  const origin = useRef(scope());
  const source = useDiscussionAdoptionSource(initialSource);
  const projectId = data.project.id;
  const [baseline, setBaseline] = useState<Baseline>(() => ({
    version: requirementVersion ?? data.version,
    revision: requirement.flow.revision,
    basis: requirement.basis,
    requirement,
    workspace: data,
  }));
  const newRow = (): TaskPlanRow => ({
    key: `draft-${crypto.randomUUID()}`,
    selected: true,
    title: "",
    description: "",
    owner_id: baseline.requirement.flow.owner_id || "",
    priority: baseline.requirement.priority as TaskPlanRow["priority"],
    estimate: "M",
    acceptance_criteria: [],
    requirement_criteria_indices: [],
    depends_on: [],
    starts_on: null,
    ends_on: null,
    blocked_reason: "",
  });
  const [rows, setRows] = useState<TaskPlanRow[]>(() => [
    {
      ...newRow(),
      ...(initialSource
        ? {
            title: initialSource.thread.title,
            description: initialSource.message.body || "",
            acceptance_criteria:
              initialSource.field === "acceptance_criteria"
                ? [initialSource.message.body || ""]
                : [],
          }
        : {}),
    },
  ]);
  const [generator, setGenerator] = useState<"manual" | "template" | "ai">(
    "manual",
  );
  const [mode, setMode] = useState<PlanPreviewRequest["mode"]>("fullstack");
  const [maxItems, setMaxItems] = useState(8);
  const [preview, setPreview] = useState<TaskPlanPreview | null>(null);
  const [previous, setPrevious] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(false);
  const [latest, setLatest] = useState<RequirementEditableResponse | null>(
    null,
  );
  const previewRequest = useRef<PlanPreviewRequest>();
  const submitIntent = useRef<DeliveryIntent>({
    version: requirementVersion ?? data.version,
    key: crypto.randomUUID(),
  });
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  const [unknown, setUnknown] = useState(false);
  const pending = useRef<{
    payload: Record<string, unknown>;
    intent: DeliveryIntent;
    source: DiscussionAdoption["reference"] | undefined;
  }>();
  const criteria = baseline.requirement.acceptance_criteria;
  const items = selectedPlanItems(rows);
  const availableTasks: { id: string; title: string; req_id: string }[] = [];
  const problems = taskPlanProblems(
    rows,
    criteria.length,
    rows.flatMap((row) =>
      row.depends_on.filter((id) => !id.startsWith("draft-")),
    ),
  );
  const coverage = new Set(
    items.flatMap((item) => item.requirement_criteria_indices),
  );
  const update = (key: string, value: Partial<TaskPlanRow>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...value } : row)),
    );
  const guarded = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    if (origin.current !== scope()) {
      setError(common("scopeChanged"));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      const failure = planError(e);
      setError(failure.conflict ? "" : failure.message);
      setConflict(failure.conflict);
      setLatest(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const generate = (fresh = true) =>
    void guarded(async () => {
      if (generator === "manual" && fresh) return;
      if (fresh || !previewRequest.current)
        previewRequest.current = {
          requirement_id: requirement.id,
          expected_version: baseline.version,
          idempotency_key: crypto.randomUUID(),
          generator: generator === "manual" ? "template" : generator,
          mode,
          max_items: maxItems,
        };
      controller.current = new AbortController();
      setGenerationFailed(true);
      const result = await previewTaskPlan(
        projectId,
        previewRequest.current,
        controller.current.signal,
      );
      if (origin.current !== scope()) return;
      setPrevious({ rows, baseline, preview });
      setRows(
        result.items.map((item) => ({
          ...item,
          selected: true,
          owner_id: item.owner_id || baseline.requirement.flow.owner_id || "",
        })),
      );
      setBaseline((current) => ({
        ...current,
        version: result.version,
        revision: result.requirement_revision,
        basis: result.requirement_basis,
      }));
      submitIntent.current = {
        version: result.version,
        key: crypto.randomUUID(),
      };
      setPreview(result);
      setConflict(false);
      setGenerationFailed(false);
      setNotice("");
    });
  const save = (retry = false) =>
    void guarded(async () => {
      if (!retry && (problems.length || conflict || unknown)) return;
      const payload = {
        requirement_id: requirement.id,
        requirement_revision: baseline.revision,
        ...(baseline.basis ? { requirement_basis: baseline.basis } : {}),
        ...(preview ? { preview_id: preview.id } : {}),
        items,
      };
      if (!retry) {
        submitIntent.current = prepareDeliveryIntent(
          submitIntent.current,
          "tasks.plan",
          payload,
          source.current.current?.reference,
        );
        pending.current = {
          payload: structuredClone(payload),
          intent: structuredClone(submitIntent.current),
          source: source.current.current
            ? structuredClone(source.current.current.reference)
            : undefined,
        };
      }
      const command = pending.current;
      if (!command) return;
      onUnresolvedChange?.(true);
      try {
        const result = await saveDelivery(
          projectId,
          "tasks.plan",
          command.payload,
          command.intent.version,
          command.intent.key,
          command.source,
        );
        if (origin.current === scope()) {
          setUnknown(false);
          onUnresolvedChange?.(false);
          onSaved(result);
        }
      } catch (error) {
        const problem = discussionFailure(error);
        const unresolved = Boolean(initialSource) && problem.unknown;
        setUnknown(unresolved);
        if (!unresolved) onUnresolvedChange?.(false);
        if (initialSource && problem.conflict) {
          setConflict(true);
          setLatest(null);
          setError(problem.message);
          return;
        }
        throw error;
      }
    });
  const loadLatest = () =>
    void guarded(async () => {
      setLatest(await fetchEditableRequirement(projectId, requirement.id));
    });
  const adopt = () => {
    const req = latest?.requirement;
    if (!req || !latest) return;
    const changed =
      JSON.stringify([
        req.title,
        req.description,
        req.acceptance_criteria,
        req.flow.revision,
      ]) !==
      JSON.stringify([
        baseline.requirement.title,
        baseline.requirement.description,
        criteria,
        baseline.revision,
      ]);
    setRows((current) =>
      remapPlanCriteria(current, criteria, req.acceptance_criteria),
    );
    setBaseline({
      version: latest.version,
      revision: req.flow.revision,
      requirement: req,
      workspace: {
        ...baseline.workspace,
        version: latest.version,
        query_generation: latest.query_generation,
      },
      basis: req.basis,
    });
    if (changed) {
      setPreview(null);
      setNotice(tr("scopeExpired"));
    }
    submitIntent.current = {
      version: latest.version,
      key: crypto.randomUUID(),
    };
    previewRequest.current = undefined;
    setGenerationFailed(false);
    setConflict(false);
    setError("");
    setLatest(null);
  };
  const latestReq = latest?.requirement;

  return (
    <Modal
      open
      title={tr("title")}
      width={960}
      className="delivery-task-plan-editor"
      onCancel={() => !unknown && !busy && onClose()}
      closable={!busy && !unknown}
      maskClosable={false}
      keyboard={!busy && !unknown}
      footer={
        <Space wrap>
          <Button onClick={onClose} disabled={busy || unknown}>
            {common("cancel")}
          </Button>
          <Button
            type="primary"
            onClick={() => save()}
            loading={busy}
            disabled={busy || unknown || conflict || Boolean(problems.length)}
          >
            {tr("create")} · {items.length}
          </Button>
        </Space>
      }
    >
      <DiscussionAdoptionSource
        projectId={projectId}
        source={source}
        disabled={busy || unknown}
      />
      {unknown && (
        <Alert
          type="warning"
          title={t("deliveryDiscussion.unknown")}
          action={
            <Button loading={busy} onClick={() => save(true)}>
              {t("deliveryDiscussion.retryOriginal")}
            </Button>
          }
        />
      )}
      <p className="delivery-hint">{tr("hint")}</p>
      <section className="delivery-plan-context">
        <div>
          <Tag>{t("delivery.revision", { number: baseline.revision })}</Tag>
          <strong>{baseline.requirement.title}</strong>
        </div>
        <details>
          <summary>
            {tr("snapshot")} · {criteria.length}
          </summary>
          <ol>
            {criteria.map((criterion, index) => (
              <li key={index}>{criterion}</li>
            ))}
          </ol>
          <p>{baseline.requirement.description}</p>
        </details>
        <small>
          {tr("existing")}: {baseline.requirement.tasks_total}
        </small>
      </section>
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          className="delivery-form-error"
        />
      )}
      {notice && <Alert type="warning" showIcon title={notice} />}
      {conflict && (
        <section className="delivery-plan-conflict">
          <Alert type="warning" title={tr("conflict")} />
          <Button onClick={loadLatest} loading={busy}>
            {tr("loadLatest")}
          </Button>
          {latestReq && (
            <>
              <h3>{tr("latest")}</h3>
              <strong>{latestReq.title}</strong>
              <p>{latestReq.description}</p>
              <ol>
                {latestReq.acceptance_criteria.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ol>
              <p>
                {tr("existing")}: {latestReq.tasks_total}
              </p>
              <Button onClick={adopt}>{tr("adopt")}</Button>
            </>
          )}
        </section>
      )}
      <div className="delivery-plan-toolbar">
        <Select
          aria-label={tr("source")}
          value={generator}
          onChange={setGenerator}
          disabled={busy || unknown}
          options={["manual", "template", "ai"].map((value) => ({
            value,
            label: tr(value),
          }))}
        />
        {generator !== "manual" && (
          <>
            <Select
              aria-label={tr("mode")}
              value={mode}
              onChange={setMode}
              disabled={busy || unknown}
              options={["fullstack", "frontend", "backend", "testing"].map(
                (value) => ({ value, label: tr(value) }),
              )}
            />
            <InputNumber
              aria-label={tr("maxItems")}
              value={maxItems}
              min={1}
              max={40}
              onChange={(value) => setMaxItems(value || 1)}
              disabled={busy || unknown}
            />
            <Button
              icon={<Sparkles size={14} />}
              loading={busy}
              disabled={busy || unknown || conflict}
              onClick={() => generate(true)}
            >
              {tr(preview || generationFailed ? "regenerate" : "generate")}
            </Button>
          </>
        )}
        {generationFailed && previewRequest.current && (
          <Button
            disabled={busy || unknown || conflict}
            onClick={() => generate(false)}
          >
            {tr("retryRequest")}
          </Button>
        )}
        {previous && (
          <Button
            icon={<RotateCcw size={14} />}
            disabled={busy || unknown}
            onClick={() => {
              const current = { rows, baseline, preview };
              setRows(previous.rows);
              setBaseline(previous.baseline);
              setPreview(previous.preview);
              submitIntent.current = {
                version: previous.baseline.version,
                key: crypto.randomUUID(),
              };
              setPrevious(current);
              setConflict(false);
              setError("");
            }}
          >
            {tr("restore")}
          </Button>
        )}
      </div>
      {generator !== "manual" && (
        <p className="delivery-hint">{tr("replaceHint")}</p>
      )}
      {preview && (
        <section className="delivery-plan-provenance">
          <Tag color={preview.source === "ai" ? "purple" : "blue"}>
            {tr(preview.source)}
          </Tag>
          <span>
            {preview.model && `${preview.provider} · ${preview.model} · `}
            {tr("edited")}
          </span>
          {preview.source === "ai" && (
            <small>
              {tr("usage")}: {preview.usage.total_tokens} tokens · $
              {preview.usage.cost_usd.toFixed(6)}
            </small>
          )}
          {preview.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </section>
      )}
      <div className="delivery-plan-summary">
        <strong>{tr("count", { count: items.length })}</strong>
        <Tag color={coverage.size === criteria.length ? "success" : "warning"}>
          {tr("coverage", { covered: coverage.size, total: criteria.length })}
        </Tag>
      </div>
      {criteria.some((_, index) => !coverage.has(index)) && (
        <details className="delivery-plan-uncovered">
          <summary>{tr("uncovered")}</summary>
          <ul>
            {criteria.map(
              (criterion, index) =>
                !coverage.has(index) && <li key={index}>{criterion}</li>,
            )}
          </ul>
        </details>
      )}
      {problems.length > 0 && rows.some((row) => row.title.trim()) && (
        <Alert
          type="warning"
          showIcon
          title={[
            ...new Set(
              problems.map((problem) => tr(`problems.${problem.code}`)),
            ),
          ].join(" · ")}
        />
      )}
      <div className="delivery-plan-rows">
        {!rows.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        {rows.map((row, index) => {
          const label = (text: string) =>
            `${text} · ${tr("item", { number: index + 1 })}`;
          const dependencyOptions = [
            ...rows
              .filter((item) => item.key !== row.key)
              .map((item, number) => ({
                value: item.key,
                label: item.title || tr("item", { number: number + 1 }),
                disabled: !item.selected,
              })),
            ...availableTasks.map((task) => ({
              value: task.id,
              label: `${task.title} · ${task.id}`,
            })),
          ];
          return (
            <article
              className={`delivery-plan-row ${row.selected ? "" : "is-deselected"}`}
              key={row.key}
            >
              <header>
                <Checkbox
                  checked={row.selected}
                  onChange={(event) =>
                    update(row.key, { selected: event.target.checked })
                  }
                  disabled={busy || unknown}
                  aria-label={tr("selected", { number: index + 1 })}
                >
                  {tr("item", { number: index + 1 })}
                </Checkbox>
                <Button
                  type="text"
                  size="small"
                  icon={<Trash2 size={14} />}
                  aria-label={label(tr("remove"))}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((item) => item.key !== row.key),
                    )
                  }
                  disabled={busy || unknown}
                />
              </header>
              <label>
                {common("titleField")}
                <Input
                  aria-label={label(common("titleField"))}
                  value={row.title}
                  maxLength={256}
                  onChange={(event) =>
                    update(row.key, { title: event.target.value })
                  }
                  disabled={busy || unknown}
                />
              </label>
              <label>
                {common("description")}
                <Input.TextArea
                  aria-label={label(common("description"))}
                  value={row.description}
                  rows={2}
                  maxLength={10000}
                  onChange={(event) =>
                    update(row.key, { description: event.target.value })
                  }
                  disabled={busy || unknown}
                />
              </label>
              <div className="delivery-plan-fields">
                <label>
                  {common("owner")}
                  <ProjectOwnerSelect
                    queryGeneration={baseline.workspace.query_generation}
                    label={label(common("owner"))}
                    value={row.owner_id}
                    onChange={(value) => update(row.key, { owner_id: value })}
                    disabled={busy || unknown}
                  />
                </label>
                <label>
                  {common("priority")}
                  <Select
                    aria-label={label(common("priority"))}
                    value={row.priority}
                    options={["P0", "P1", "P2", "P3"].map((value) => ({
                      value,
                      label: value,
                    }))}
                    onChange={(value) => update(row.key, { priority: value })}
                    disabled={busy || unknown}
                  />
                </label>
                <label>
                  {common("estimate")}
                  <Select
                    aria-label={label(common("estimate"))}
                    value={row.estimate}
                    options={["XS", "S", "M", "L", "XL"].map((value) => ({
                      value,
                      label: value,
                    }))}
                    onChange={(value) => update(row.key, { estimate: value })}
                    disabled={busy || unknown}
                  />
                </label>
              </div>
              <div className="task-plan-own-criteria">
                <strong>{t("deliveryTaskAcceptance.ownCriteria")}</strong>
                <TaskCriteriaEditor
                  value={row.acceptance_criteria}
                  onChange={(acceptance_criteria) =>
                    update(row.key, { acceptance_criteria })
                  }
                  disabled={busy || unknown}
                />
              </div>
              <div className="delivery-plan-fields is-pair">
                <label>
                  {t("deliveryTaskAcceptance.requirementCriteria")}
                  <Select
                    mode="multiple"
                    aria-label={label(tr("criteria"))}
                    value={row.requirement_criteria_indices}
                    options={criteria.map((text, value) => ({
                      value,
                      label: `${value + 1}. ${text}`,
                    }))}
                    onChange={(value) =>
                      update(row.key, { requirement_criteria_indices: value })
                    }
                    disabled={busy || unknown}
                  />
                </label>
                <label>
                  {tr("dependencies")}
                  <DeliveryReferenceSelect
                    kind="task"
                    queryGeneration={baseline.workspace.query_generation}
                    multiple
                    label={label(tr("dependencies"))}
                    value={row.depends_on}
                    options={dependencyOptions}
                    onChange={(value) => update(row.key, { depends_on: value })}
                    disabled={busy || unknown}
                  />
                </label>
              </div>
              <div className="delivery-plan-fields is-pair">
                <label>
                  {tr("starts")}
                  <Input
                    type="date"
                    aria-label={label(tr("starts"))}
                    value={row.starts_on || ""}
                    onChange={(event) =>
                      update(row.key, { starts_on: event.target.value || null })
                    }
                    disabled={busy || unknown}
                  />
                </label>
                <label>
                  {tr("ends")}
                  <Input
                    type="date"
                    aria-label={label(tr("ends"))}
                    value={row.ends_on || ""}
                    onChange={(event) =>
                      update(row.key, { ends_on: event.target.value || null })
                    }
                    disabled={busy || unknown}
                  />
                </label>
              </div>
              <label>
                {common("blockedReason")}
                <Input
                  aria-label={label(common("blockedReason"))}
                  value={row.blocked_reason}
                  maxLength={2000}
                  onChange={(event) =>
                    update(row.key, { blocked_reason: event.target.value })
                  }
                  disabled={busy || unknown}
                />
              </label>
            </article>
          );
        })}
      </div>
      <Button
        icon={<Plus size={14} />}
        disabled={busy || unknown || rows.length >= 40}
        onClick={() => setRows((current) => [...current, newRow()])}
      >
        {tr("add")}
      </Button>
    </Modal>
  );
}
