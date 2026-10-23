import type {
  RequirementEditable,
  RequirementEditableResponse,
} from "@/lib/deliveryRequirementReads";
import {
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
  Popconfirm,
  Select,
  Space,
  Tag,
} from "antd";
import { Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  prepareDeliveryIntent,
  type DeliveryIntent,
  type DeliveryContext,
} from "@/lib/delivery";
import {
  planError,
  assignSelectedPlanRows,
  previewTaskPlan,
  remapPlanCriteria,
  selectedPlanItems,
  taskPlanProblems,
  type PlanPreviewRequest,
  type TaskPlanRow,
} from "@/lib/deliveryTaskPlan";
import { useTaskPlanRetention } from "@/lib/useTaskPlanRetention";
import { type RetainedTaskPlanDraft, type PlanProvenance, type TaskPlanOriginal } from "@/lib/taskPlanRetention";
import { TaskPlanRecoveryModal } from "./TaskPlanRecoveryModal";
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
  preview: PlanProvenance | null;
};

export function DeliveryTaskPlanForm({
  data,
  requirement,
  requirementVersion,
  onClose,
  onSaved,
  initialSource,
  onUnresolvedChange,
  retention,
  canWriteCurrent,
}: {
  data: DeliveryContext;
  requirement: RequirementEditable;
  requirementVersion?: number;
  onClose: () => void;
  onSaved: (updated: DeliveryCommandAck) => void;
  initialSource?: DiscussionAdoption;
  onUnresolvedChange?: (value: boolean) => void;
  retention: ReturnType<typeof useTaskPlanRetention>;
  canWriteCurrent?: () => boolean;
}) {
  const { t } = useTranslation();
  const tr = (key: string, values?: Record<string, unknown>) =>
    t(`delivery.taskPlan.${key}`, values);
  const common = (key: string) => t(`delivery.${key}`);
  const origin = useRef(projectSessionKey());
  const projectId = data.project.id;
  const restored = useRef(retention.view.draft).current;
  const source = useDiscussionAdoptionSource(restored ? undefined : initialSource);
  const identity = JSON.stringify([projectId, requirement.id]);
  const initialIdentity = useRef(identity);
  const access = useRef({ identity, write: data.permissions.write });
  access.current = { identity, write: data.permissions.write };
  const readOnly = !access.current.write || initialIdentity.current !== identity;
  const [baseline, setBaselineState] = useState<Baseline>(() => ({
    version: restored?.version ?? requirementVersion ?? data.version,
    revision: restored?.revision ?? requirement.flow.revision,
    basis: restored?.basis ?? requirement.basis,
    requirement: restored ? { ...requirement, ...restored.requirement, basis: restored.basis,
      flow: { ...requirement.flow, revision: restored.revision, owner_id: restored.requirement.owner_id } } : requirement,
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
  const [rows, setRowsState] = useState<TaskPlanRow[]>(() => restored?.rows || [
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
  const [generator, setGeneratorState] = useState<"manual" | "template" | "ai">(
    restored?.generator || "manual",
  );
  const [mode, setModeState] = useState<PlanPreviewRequest["mode"]>(restored?.mode || "fullstack");
  const [maxItems, setMaxItemsState] = useState(restored?.max_items || 8);
  const [preview, setPreviewState] = useState<PlanProvenance | null>(restored?.preview || null);
  const [previous, setPrevious] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(Boolean(restored && (restored.version !== (requirementVersion ?? data.version) || restored.basis !== requirement.basis)));
  const [generationFailed, setGenerationFailed] = useState(Boolean(restored?.preview_request));
  const [latest, setLatest] = useState<RequirementEditableResponse | null>(
    null,
  );
  const previewRequest = useRef<PlanPreviewRequest | undefined>(restored?.preview_request || undefined);
  const submitIntent = useRef<DeliveryIntent>({
    version: requirementVersion ?? data.version,
    key: crypto.randomUUID(),
  });
  const controller = useRef<AbortController>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  const [unknown, setUnknown] = useState(false);
  const unknownRef = useRef(false);
  const [batchOwner, setBatchOwner] = useState("");
  const [replaceOwners, setReplaceOwners] = useState(false);
  const model = useRef<RetainedTaskPlanDraft>();
  const draftBatch = useRef(0);
  if (!model.current) model.current = {
    version: baseline.version, revision: baseline.revision, basis: baseline.basis || "",
    requirement: { id: requirement.id, title: baseline.requirement.title, description: baseline.requirement.description,
      acceptance_criteria: baseline.requirement.acceptance_criteria, priority: baseline.requirement.priority as RetainedTaskPlanDraft["requirement"]["priority"],
      owner_id: baseline.requirement.flow.owner_id || "" }, rows, generator, mode, max_items: maxItems, preview,
    preview_request: previewRequest.current || null, source_reference: restored?.source_reference || initialSource?.reference || null,
  };
  const persist = (patch: Partial<RetainedTaskPlanDraft>) => {
    model.current = { ...model.current!, ...patch };
    return draftBatch.current > 0 || retention.store.saveDraft(model.current);
  };
  const batch = (action: () => void) => {
    draftBatch.current++;
    try { action(); } finally { if (--draftBatch.current === 0) retention.store.saveDraft(model.current!); }
  };
  const setRows = (next: TaskPlanRow[] | ((current: TaskPlanRow[]) => TaskPlanRow[])) => {
    const value = typeof next === "function" ? next(model.current!.rows) : next; persist({ rows: value }); setRowsState(value);
  };
  const setBaseline = (next: Baseline | ((current: Baseline) => Baseline)) => {
    const value = typeof next === "function" ? next(baseline) : next;
    persist({ version: value.version, revision: value.revision, basis: value.basis || "", requirement: {
      id: requirement.id, title: value.requirement.title, description: value.requirement.description,
      acceptance_criteria: value.requirement.acceptance_criteria, priority: value.requirement.priority as RetainedTaskPlanDraft["requirement"]["priority"],
      owner_id: value.requirement.flow.owner_id || "",
    } }); setBaselineState(value);
  };
  const setGenerator = (value: "manual" | "template" | "ai") => { persist({ generator: value }); setGeneratorState(value); };
  const setMode = (value: PlanPreviewRequest["mode"]) => { persist({ mode: value }); setModeState(value); };
  const setMaxItems = (value: number) => { persist({ max_items: value }); setMaxItemsState(value); };
  const setPreview = (value: PlanProvenance | null) => {
    const next = value ? { id: value.id, source: value.source, model: value.model, provider: value.provider, usage: value.usage, warnings: value.warnings } : null;
    persist({ preview: next }); setPreviewState(next);
  };
  useEffect(() => {
    if (retention.view.owned && retention.view.command.phase === "idle" && !retention.view.draft)
      retention.store.saveDraft(model.current!);
  }, [retention.store, retention.view.owned]);
  const criteria = baseline.requirement.acceptance_criteria;
  const items = selectedPlanItems(rows);
  const availableTasks: { id: string; title: string; req_id: string }[] = [];
  const problems = taskPlanProblems(
    rows,
    criteria.length,
    rows.flatMap((row) =>
      row.depends_on.filter((id) => !rows.some((item) => item.key === id)),
    ),
  );
  const coverage = new Set(
    items.flatMap((item) => item.requirement_criteria_indices),
  );
  const canEdit = () => mounted.current && origin.current === projectSessionKey() &&
    initialIdentity.current === identity && access.current.identity === identity && access.current.write && (!canWriteCurrent || canWriteCurrent()) && retention.store.current() && retention.store.snapshot().command.phase === "idle";
  const locked = () => busyRef.current || unknownRef.current || !canEdit();
  const edit = (action: () => void) => {
    if (!locked()) action();
  };
  const close = () => {
    if (mounted.current && !busyRef.current && retention.store.snapshot().status !== "unavailable") { retention.store.close(); onUnresolvedChange?.(false); onClose(); }
  };
  const update = (key: string, value: Partial<TaskPlanRow>) =>
    edit(() =>
      setRows((current) =>
        current.map((row) => (row.key === key ? { ...row, ...value } : row)),
      ),
    );
  const guarded = async (action: () => Promise<void>, retryOriginal = false) => {
    if (busyRef.current || (unknownRef.current && !retryOriginal)) return;
    if (origin.current !== projectSessionKey()) {
      setError(common("scopeChanged"));
      return;
    }
    if (!canEdit()) {
      setError(tr("readOnly"));
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
      if (!persist({ preview_request: previewRequest.current! })) throw new Error(tr("local.unavailable"));
      controller.current = new AbortController();
      setGenerationFailed(true);
      const result = await previewTaskPlan(
        projectId,
        previewRequest.current,
        controller.current.signal,
      );
      if (!canEdit()) return;
      setPrevious({ rows, baseline, preview });
      batch(() => {
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
      previewRequest.current = undefined; persist({ preview_request: null });
      });
      setConflict(false);
      setGenerationFailed(false);
      setNotice("");
    });
  const save = () => void guarded(async () => {
    if (problems.length || conflict || !retention.store.saveDraft(model.current!)) return;
    const draft = model.current!;
    const payload: TaskPlanOriginal["payload"] = { requirement_id: requirement.id, requirement_revision: draft.revision,
      requirement_basis: draft.basis, ...(draft.preview ? { preview_id: draft.preview.id } : {}), items: selectedPlanItems(draft.rows) };
    submitIntent.current = prepareDeliveryIntent({ ...submitIntent.current, version: draft.version }, "tasks.plan", payload, draft.source_reference || undefined);
    const result = await retention.store.run({ action: "tasks.plan", payload,
      intent: { version: submitIntent.current.version, key: submitIntent.current.key },
      ...(draft.source_reference ? { source_reference: structuredClone(draft.source_reference) } : {}) });
    unknownRef.current = retention.store.snapshot().command.phase === "unknown";
    setUnknown(unknownRef.current);
    if (result && retention.store.retainReceipt() && mounted.current && origin.current === projectSessionKey()) {
      onUnresolvedChange?.(false); onSaved(result);
    }
  });
  const loadLatest = () =>
    void guarded(async () => {
      setLatest(await fetchEditableRequirement(projectId, requirement.id));
    });
  const adopt = () => {
    if (locked()) return;
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
    batch(() => {
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
    previewRequest.current = undefined; persist({ preview_request: null });
    });
    setGenerationFailed(false);
    setConflict(false);
    setError("");
    setLatest(null);
  };
  const latestReq = latest?.requirement;

  if (!retention.view.owned || retention.view.command.phase !== "idle") return <TaskPlanRecoveryModal
    store={retention.store} onClose={onClose} onSaved={onSaved} onUnresolvedChange={onUnresolvedChange}
    onEdit={() => { unknownRef.current = false; setUnknown(false); setConflict(true); setLatest(null); }} />;
  return (
    <Modal
      open
      title={tr("title")}
      width={960}
      className="delivery-task-plan-editor"
      onCancel={close}
      closable={!busy && !unknown}
      maskClosable={false}
      keyboard={!busy && !unknown}
      footer={
        <Space wrap>
          <Button onClick={close} disabled={busy || unknown}>
            {common("cancel")}
          </Button>
          <Button
            type="primary"
            onClick={() => save()}
            loading={busy}
            disabled={busy || unknown || readOnly || conflict || retention.view.status !== "saved" || Boolean(problems.length)}
          >
            {tr("create")} · {items.length}
          </Button>
        </Space>
      }
    >
      <DiscussionAdoptionSource
        projectId={projectId}
        source={{
          ...source,
          load: async (id) => {
            if (!locked()) await source.load(id);
          },
          adopt: () => edit(() => { source.adopt(); persist({ source_reference: source.current.current?.reference || null }); }),
          remove: () => edit(() => { source.remove(); persist({ source_reference: null }); }),
        }}
        disabled={busy || unknown || readOnly}
      />
      <Alert type={retention.view.status === "unavailable" ? "error" : "info"}
        title={tr(`local.${retention.view.status}`)} action={retention.view.status === "unavailable" ? <Space wrap>
          <Button disabled={busy} onClick={() => { if (!busyRef.current) retention.store.saveDraft(model.current!); }}>{tr("retryLocalSave")}</Button>
          <Popconfirm title={tr("closeUnsavedConfirm")}
          onConfirm={() => { if (!busyRef.current) { retention.store.close(); onUnresolvedChange?.(false); onClose(); } }}>
          <Button disabled={busy}>{tr("closeUnsaved")}</Button>
        </Popconfirm></Space> : undefined} />
      {restored && <Alert type="info" title={tr("restoredDraft")} />}
      {model.current.source_reference && !source.value && <Alert type="info" title={tr("restoredSource")}
        description={`${model.current.source_reference.thread_id} · ${model.current.source_reference.message_id} · ${model.current.source_reference.message_revision}`}
        action={<Button disabled={busy} onClick={() => edit(() => persist({ source_reference: null }))}>{t("deliveryDiscussion.dropSource")}</Button>} />}
      <p className="delivery-hint">{tr("hint")}</p>
      {readOnly && <Alert type="info" title={tr("readOnly")} />}
      <section className="delivery-plan-context">
        <div>
          <Tag>{data.project.name}</Tag>
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
          onChange={(value) => edit(() => setGenerator(value))}
          disabled={busy || unknown || readOnly}
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
              onChange={(value) => edit(() => setMode(value))}
              disabled={busy || unknown || readOnly}
              options={["fullstack", "frontend", "backend", "testing"].map(
                (value) => ({ value, label: tr(value) }),
              )}
            />
            <InputNumber
              aria-label={tr("maxItems")}
              value={maxItems}
              min={1}
              max={40}
              onChange={(value) => edit(() => setMaxItems(value || 1))}
              disabled={busy || unknown || readOnly}
            />
            <Button
              icon={<Sparkles size={14} />}
              loading={busy}
              disabled={busy || unknown || readOnly || conflict}
              onClick={() => generate(true)}
            >
              {tr(preview || generationFailed ? "regenerate" : "generate")}
            </Button>
          </>
        )}
        {generationFailed && previewRequest.current && (
          <Button
            disabled={busy || unknown || readOnly || conflict}
            onClick={() => generate(false)}
          >
            {tr("retryRequest")}
          </Button>
        )}
        {previous && (
          <Button
            icon={<RotateCcw size={14} />}
            disabled={busy || unknown || readOnly}
            onClick={() => {
              if (locked()) return;
              const current = { rows, baseline, preview };
              batch(() => {
              setRows(previous.rows);
              setBaseline(previous.baseline);
              setPreview(previous.preview);
              });
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
        <span>{tr("assignmentCount", { assigned: items.filter((item) => item.owner_id).length,
          unassigned: items.filter((item) => !item.owner_id).length })}</span>
        <Tag color={coverage.size === criteria.length ? "success" : "warning"}>
          {tr("coverage", { covered: coverage.size, total: criteria.length })}
        </Tag>
      </div>
      <section className="delivery-plan-assignment" aria-label={tr("batchAssignment")}>
        <div>
          <strong>{tr("batchAssignment")}</strong>
          <p className="delivery-hint">{tr("batchHint")}</p>
        </div>
        <ProjectOwnerSelect queryGeneration={baseline.workspace.query_generation}
          label={tr("batchOwner")} value={batchOwner}
          onChange={(id) => edit(() => setBatchOwner(id))} disabled={busy || unknown || readOnly} />
        <Checkbox checked={replaceOwners} disabled={busy || unknown || readOnly}
          onChange={(event) => edit(() => setReplaceOwners(event.target.checked))}>
          {tr("replaceOwners")}
        </Checkbox>
        <div className="delivery-actions">
          <Button disabled={busy || unknown || readOnly || !batchOwner || !items.length}
            onClick={() => edit(() => setRows((current) =>
              assignSelectedPlanRows(current, batchOwner, replaceOwners ? "replace" : "unassigned")))}>
            {tr("applyOwner")}
          </Button>
          <Button type="text" disabled={busy || unknown || readOnly || !items.some((item) => item.owner_id)}
            onClick={() => edit(() => setRows((current) => assignSelectedPlanRows(current, "", "clear")))}>
            {tr("clearSelectedOwners")}
          </Button>
        </div>
      </section>
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
          const rowProblems = problems.filter((problem) => problem.key === row.key);
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
                  disabled={busy || unknown || readOnly}
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
                    edit(() =>
                      setRows((current) =>
                        current.filter((item) => item.key !== row.key),
                      ),
                    )
                  }
                  disabled={busy || unknown || readOnly}
                />
              </header>
              {row.selected && rowProblems.length > 0 && <Alert type="warning" showIcon
                title={tr("itemProblems", { number: index + 1 })}
                description={[...new Set(rowProblems.map((problem) => tr(`problems.${problem.code}`)))].join(" · ")} />}
              <label>
                {common("titleField")}
                <Input
                  aria-label={label(common("titleField"))}
                  value={row.title}
                  maxLength={256}
                  onChange={(event) =>
                    update(row.key, { title: event.target.value })
                  }
                  disabled={busy || unknown || readOnly}
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
                  disabled={busy || unknown || readOnly}
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
                    disabled={busy || unknown || readOnly}
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
                    disabled={busy || unknown || readOnly}
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
                    disabled={busy || unknown || readOnly}
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
                  disabled={busy || unknown || readOnly}
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
                    disabled={busy || unknown || readOnly}
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
                    disabled={busy || unknown || readOnly}
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
                    disabled={busy || unknown || readOnly}
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
                    disabled={busy || unknown || readOnly}
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
                  disabled={busy || unknown || readOnly}
                />
              </label>
            </article>
          );
        })}
      </div>
      <Button
        icon={<Plus size={14} />}
        disabled={busy || unknown || rows.length >= 40}
        onClick={() =>
          edit(() => setRows((current) => [...current, newRow()]))
        }
      >
        {tr("add")}
      </Button>
    </Modal>
  );
}

export function DeliveryTaskPlanEditor(props: Omit<Parameters<typeof DeliveryTaskPlanForm>[0], "retention">) {
  const retention = useTaskPlanRetention(props.data.project.id, props.requirement.id, props.onUnresolvedChange);
  return <DeliveryTaskPlanForm {...props} retention={retention} />;
}
