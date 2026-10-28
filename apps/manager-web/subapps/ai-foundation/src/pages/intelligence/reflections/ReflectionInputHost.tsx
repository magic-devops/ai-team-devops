import { useQueries, useQuery } from "@tanstack/react-query";
import { Alert, Button, Input, Modal, Tag } from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchDeliveryContext } from "@/lib/deliveryQuery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import { prepareReflectionInputOriginal, reflectionInputStorageKey, useReflectionInputCommand } from "@/lib/reflectionCommand";
import { fetchReflection, type ReflectionSelectionReference } from "@/lib/reflectionReads";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { ReflectionProblem } from "./ReflectionCommon";

type Draft = { title: string; rationale: string };
type HostProps = {
  projectId: string; sessionId: string; sources: ReflectionSelectionReference[]; open?: boolean; allowNew?: boolean;
  onSaved: (ack: DeliveryCommandAck) => void; onClose: () => void; onPending: (pending: boolean) => void;
};
export function ReflectionInputHost(props: HostProps) {
  const command = useReflectionInputCommand(props.projectId, props.onPending);
  return ReflectionInputForm({ ...props, command });
}
export function ReflectionInputForm({ projectId, sessionId, sources, open = true, allowNew = true, onSaved, onClose, command }: HostProps & { command: ReturnType<typeof useReflectionInputCommand> }) {
  const { t } = useTranslation();
  const identity = JSON.stringify([projectId, sessionId]);
  // Recovery is constructed before (and independently from) every current read.
  const [storedDraft, setDraft] = useState<{ identity: string; value: Draft }>(() => {
    try {
      const key = reflectionInputStorageKey(projectId), value = key ? JSON.parse(sessionStorage.getItem(key + ":draft") || "null") : null;
      if (value && typeof value.title === "string" && typeof value.rationale === "string") return { identity, value };
    } catch { /* An unsent draft is optional; the command original is not. */ }
    return { identity, value: { title: "", rationale: "" } };
  });
  const draft = storedDraft.identity === identity ? storedDraft.value : { title: "", rationale: "" };
  const draftRef = useRef(draft); draftRef.current = draft;
  const [inputError, setInputError] = useState("");
  const context = useQuery({
    queryKey: ["reflection-input-context", projectId, sessionId],
    queryFn: ({ signal }) => fetchDeliveryContext(projectId, signal),
    enabled: !!projectId && allowNew && open && !command.unresolved,
    retry: false, gcTime: 0, refetchOnWindowFocus: false,
  });
  const previews = useQueries({ queries: sources.map((source) => ({
    queryKey: ["reflection-input-preview", projectId, sessionId, source.reflection_id, source.source_digest, source.attempt_id],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchReflection(projectId, source.reflection_id, signal),
    enabled: !!projectId && allowNew && open && !command.unresolved,
    staleTime: 0, refetchOnMount: "always" as const, retry: false, gcTime: 0, refetchOnWindowFocus: false,
  })) });
  const previewMatches = (index: number) => {
    const query = previews[index], source = sources[index], value = query?.data, ref = value?.selection_reference;
    return !!source && !!value && !query.error && !query.isPending && !query.isFetching && value.project_id === projectId && value.reflection.id === source.reflection_id && value.available && !!value.statement && value.source?.digest === source.source_digest && value.verified?.attempt_id === source.attempt_id && ref?.reflection_id === source.reflection_id && ref.source_digest === source.source_digest && ref.attempt_id === source.attempt_id;
  };
  const previewsReady = sources.length > 0 && previews.length === sources.length && sources.every((_, index) => previewMatches(index));
  const basis = useRef({ context, previewsReady, sources, allowNew }); basis.current = { context, previewsReady, sources, allowNew };
  const retained = command.state.original;
  const locked = command.locked;
  const visible = command.current() && sessionId === projectSessionKey() && (allowNew && open || command.unresolved || command.state.phase === "succeeded");
  const edit = (key: keyof Draft, value: string) => {
    if (!allowNew || !command.current() || sessionId !== projectSessionKey() || !["idle", "refused"].includes(command.snapshot().phase)) return;
    const next = { ...draftRef.current, [key]: value }; draftRef.current = next; setDraft({ identity, value: next });
    try { const storageKey = reflectionInputStorageKey(projectId); if (storageKey) sessionStorage.setItem(storageKey + ":draft", JSON.stringify(next)); } catch { /* Send still requires durable original storage. */ }
  };
  const complete = (ack: DeliveryCommandAck | undefined) => {
    if (!ack || !command.current() || sessionId !== projectSessionKey()) return;
    command.reset(); onSaved(ack);
  };
  async function confirm() {
    const currentContext = basis.current.context, current = currentContext.data;
    if (!basis.current.allowNew || !basis.current.previewsReady || !command.current() || command.snapshot().phase !== "idle" || sessionId !== projectSessionKey() || currentContext.error || currentContext.isFetching || !current || current.project_id !== projectId || !current.permissions.write || current.query_state.status !== "ready") return;
    try { const original = prepareReflectionInputOriginal(current.version, { ...draftRef.current, sources: basis.current.sources }); setInputError(""); complete(await command.run(original)); }
    catch { setInputError("inputInvalid"); }
  }
  const errorKey = command.state.error === "retainedOriginalUnavailable" ? "storageFailed" : command.state.error === "retainedOriginalInvalid" ? "retainedInvalid" : command.state.phase === "refused" ? "refused" : "unknownHint";
  return <Modal open={visible} title={t("reflections.prepare")} width={720} closable={!command.unresolved} keyboard={!command.unresolved} maskClosable={!command.unresolved} onCancel={() => { if (!command.unresolved && command.current()) onClose(); }} footer={
    <div className="reflection-actions">
      {!command.unresolved && <Button onClick={onClose}>{t("reflections.close")}</Button>}
      {command.state.phase === "unknown" ? <Button data-action="retry-reflection-input" type="primary" disabled={!retained} onClick={async () => complete(await command.replay())}>{t("reflections.recover")}</Button> : command.state.phase === "refused" ? <Button data-action="reset-reflection-input" disabled={!allowNew} onClick={() => { command.reset(); void context.refetch(); previews.forEach((query) => void query.refetch()); }}>{t("reflections.rereadBasis")}</Button> : <Button data-action="confirm-reflection-input" type="primary" loading={command.state.phase === "sending"} disabled={!allowNew || locked || !!context.error || context.isFetching || !context.data?.permissions.write || context.data?.query_state.status !== "ready" || !previewsReady} onClick={() => void confirm()}>{t("reflections.confirm", { count: sources.length })}</Button>}
    </div>
  }>
    <div className="reflections reflection-form">
      <p className="reflection-note">{t("reflections.preparedHint")}</p>
      {command.unresolved && <p className="reflection-note">{t("reflections.recoveryProject", { project: projectId })} · {projectId}</p>}
      {command.state.phase === "unknown" && <Alert role="alert" type="warning" title={t("reflections.unknown")} description={t("reflections." + errorKey)} />}
      {command.state.phase === "sending" && <Alert role="status" type="info" title={t("reflections.sending")} />}
      {command.state.error && command.state.phase !== "unknown" && <Alert role="alert" type="error" title={t("reflections." + errorKey)} />}
      {!command.unresolved && context.error && <ReflectionProblem error={context.error} onRetry={() => void context.refetch()} />}
      {!command.unresolved && !context.error && context.data && !context.data.permissions.write && <Alert type="warning" title={t("reflections.readOnly")} />}
      {inputError && <Alert type="error" role="alert" title={t("reflections." + inputError)} />}
      <label>{t("reflections.inputTitle")}<Input aria-label={t("reflections.inputTitle")} disabled={locked} value={retained && locked ? retained.payload.title : draft.title} onChange={(event) => edit("title", event.target.value)} /></label>
      <label>{t("reflections.rationale")}<Input.TextArea aria-label={t("reflections.rationale")} disabled={locked} rows={4} value={retained && locked ? retained.payload.rationale : draft.rationale} onChange={(event) => edit("rationale", event.target.value)} /></label>
      <div><Tag>{t("reflections.selectedCount", { count: (retained && locked ? retained.payload.sources : sources).length })}</Tag></div>
      <ol className="reflection-manifest">{(retained && locked ? retained.payload.sources : sources).map((source) => <li key={source.reflection_id}><span>{source.reflection_id}</span><details><summary>{t("reflections.identity")}</summary><code>{source.source_digest}</code><p>{source.attempt_id}</p></details></li>)}</ol>
      {!command.unresolved && allowNew && open && <section aria-label={t("reflections.preview")}><h4>{t("reflections.preview")}</h4>{sources.map((source, index) => {
        const query = previews[index], value = query?.data;
        return <article key={source.reflection_id}>{query?.error ? <ReflectionProblem error={query.error} onRetry={() => void query.refetch()} /> : previewMatches(index) && value?.statement ? <><h4>{value.statement.title}</h4><p className="reflection-statement">{value.statement.observation}</p>{value.statement.lesson && <p className="reflection-statement">{value.statement.lesson}</p>}</> : <Alert type="warning" title={t("reflections." + (value?.unavailable_reason === "reflection_source_restricted" ? "forbidden" : query?.isPending || query?.isFetching ? "previewLoading" : "selectionBlocked"))} action={<Button onClick={() => void query?.refetch()}>{t("reflections.refresh")}</Button>} />}</article>;
      })}</section>}
      <p className="reflection-note">{t("reflections.limits")}</p>
    </div>
  </Modal>;
}
