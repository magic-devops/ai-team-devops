import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Input, Modal, Select, Skeleton } from "antd";
import { useTranslation } from "react-i18next";
import { opsRemediationCopy } from "@/i18n/ops-remediation";
import { useOpsIntakeCommand, validOpsIntakeOriginal, type OpsIntakeCommand } from "@/lib/opsIntakeCommand";
import { opsIntakeOriginal, readOpsIntake, type OpsIntakeView } from "@/lib/opsRemediation";
import { issueHref } from "@/lib/deliveryIssue";

export function OpsRemediationIntake({ projectId, sourceId, sourceType = "self_heal", open, onClose }: { projectId: string; sourceId: string; sourceType?: OpsIntakeView["source_type"]; open: boolean; onClose: () => void }) {
  const command = useOpsIntakeCommand(projectId);
  // One owner exists before and after list/source failure; changed route scopes
  // remount transient editor state while the durable original survives.
  return <OpsIntakeEditor key={`${command.scope}:${sourceType}`} projectId={projectId} sourceId={sourceId} sourceType={sourceType} open={open} onClose={onClose} command={command} />;
}
export function OpsIntakeEditor({ projectId, sourceId, sourceType = "self_heal", open, onClose, command }: { projectId: string; sourceId: string; sourceType?: OpsIntakeView["source_type"]; open: boolean; onClose: () => void; command: OpsIntakeCommand }) {
  const { i18n } = useTranslation(), copy = opsRemediationCopy(i18n?.language);
  const [basis, setBasis] = useState<OpsIntakeView>(), [latest, setLatest] = useState<OpsIntakeView>();
  const [title, setTitle] = useState(""), [description, setDescription] = useState(""), [severity, setSeverity] = useState<"P0" | "P1" | "P2" | "P3">("P1");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const identity = `${sourceType}:${sourceId}`;
  const latch = useRef(false), mounted = useRef(true), selected = useRef(identity); selected.current = identity;
  const draftSource = useRef("");
  const state = command.state, retained = Boolean(state.original), locked = command.locked;
  const shownSource = state.original?.payload.source_id || sourceId;
  const shownType = state.original ? state.original.action === "issue.rca.intake" ? "rca" : "self_heal" : sourceType;
  const current = () => mounted.current && command.current();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const query = useQuery({ queryKey: ["delivery-ops-intake", projectId, command.scope, shownType, shownSource],
    queryFn: ({ signal }) => readOpsIntake(projectId, shownSource, signal, shownType), enabled: open && Boolean(shownSource) && !locked,
    retry: false, gcTime: 0, refetchOnWindowFocus: false });
  useEffect(() => { if (!open || locked || !query.data || query.error || !current()) return;
    if (basis && basis.source_id === query.data.source_id && basis.source_type === query.data.source_type) return;
    setBasis(structuredClone(query.data)); setLatest(undefined); setError("");
    if (draftSource.current !== `${query.data.source_type}:${query.data.source_id}`) {
      draftSource.current = `${query.data.source_type}:${query.data.source_id}`;
      const suggested = query.data.snapshot.trigger_condition || query.data.snapshot.incident_id || query.data.snapshot.root_cause;
      setTitle(typeof suggested === "string" && suggested.length <= 256 ? suggested : ""); setDescription("");
    }
  }, [open, query.data, query.error, shownType, shownSource, locked]);
  const fields = { title, description, severity }, draft = basis ? opsIntakeOriginal(basis, fields, "ops-preview-key") : null;
  const canSubmit = () => current() && !latch.current && !command.locked && command.snapshot().phase === "idle" && !query.error && selected.current === identity && basis?.source_type === sourceType && basis.source_id === sourceId && basis.can_intake;
  async function submit() {
    if (!canSubmit() || !basis || !draft || !validOpsIntakeOriginal(draft)) return;
    latch.current = true; setBusy(true); setError("");
    try {
      const fresh = await readOpsIntake(projectId, sourceId, undefined, sourceType);
      if (!current() || selected.current !== identity) return;
      if (fresh.source_type !== sourceType || !fresh.can_intake || fresh.version !== basis.version || fresh.source_digest !== basis.source_digest) { setLatest(fresh); setError(copy.changed); return; }
      await command.run(opsIntakeOriginal(basis, fields, crypto.randomUUID()));
    } catch (cause) { if (current()) setError((cause as Error).message); }
    finally { latch.current = false; if (current()) setBusy(false); }
  }
  const close = () => { if (!current() || latch.current || command.locked) return;
    if (command.snapshot().phase === "refused") command.reset();
    if (command.snapshot().phase === "idle") { setShowRecovery(false); onClose(); }
  };
  const original = state.original;
  return <>
    {!open && (retained || state.error) && <Button onClick={() => { if (current()) { setDeferred(false); setShowRecovery(true); } }}>{copy.original}</Button>}
    <Modal open={open || showRecovery || locked && !deferred} title={copy.title} width={720} onCancel={close}
      closable={!locked && !busy} maskClosable={false} keyboard={!locked && !busy} footer={null}>
      <div className="space-y-4">
        <Alert type="info" title={copy.reported} description={copy.hint} />
        <p className="text-xs text-[var(--muted)]">{shownType === "rca" ? copy.rca : copy.selfHeal}</p>
        {state.phase === "sending" && <p role="status">{copy.sending}</p>}
        {state.error && <Alert type="warning" title={["retainedOriginalUnavailable", "retainedOriginalInvalid"].includes(state.error) ? copy.unavailable : state.error === "ackMismatch" ? copy.unknown : state.error} />}
        {error && <Alert type="warning" title={error} />}
        {state.phase === "unknown" && <Alert type="warning" title={copy.unknown} action={<Button loading={busy} onClick={async () => { if (!current() || latch.current) return; latch.current = true; setBusy(true); try { await command.replay(); } finally { latch.current = false; if (current()) setBusy(false); } }}>{copy.recover}</Button>} />}
        {state.phase === "succeeded" && state.ack && <Alert type="success" title={copy.confirmed} action={<Button onClick={() => {
          if (!current() || command.snapshot().phase !== "succeeded" || !command.snapshot().ack) return;
          const id = command.snapshot().ack!.resource.id; command.reset();
          if (command.snapshot().phase === "idle" && current()) location.hash = issueHref(projectId, id, location.hash);
        }}>{copy.apply}</Button>} />}
        {state.phase === "refused" && <Button disabled={busy} onClick={() => { if (!current() || latch.current) return; command.reset(); if (command.snapshot().phase === "idle") { setError(""); void query.refetch(); } }}>{copy.retry}</Button>}
        {original ? <section><strong>{original.payload.title}</strong><p className="text-xs text-[var(--muted)]">{copy.original} · {shownType === "rca" ? copy.rca : copy.selfHeal} · {original.payload.source_id}</p><details><summary>{copy.details}</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(original, null, 2)}</pre></details></section> : <>
          {query.isPending && <Skeleton active paragraph={{ rows: 2 }} />}
          {query.error && <Alert type="warning" title={copy.failed} description={query.error.message} action={<Button disabled={busy} onClick={() => { if (current()) void query.refetch(); }}>{copy.retry}</Button>} />}
          {!query.error && basis && <>
            {basis.existing_issue_id ? basis.existing_issue_available ? <Button type="primary" onClick={() => { if (current() && basis.existing_issue_id) location.hash = issueHref(projectId, basis.existing_issue_id, location.hash); }}>{copy.open}</Button> : <Alert type="warning" title={copy.missingIssue} /> : <>
              <label className="block text-sm">{copy.issueTitle}<Input aria-label={copy.issueTitle} maxLength={256} value={title} disabled={locked || busy} onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="block text-sm">{copy.description}<Input.TextArea aria-label={copy.description} maxLength={10000} rows={3} value={description} disabled={locked || busy} onChange={(e) => setDescription(e.target.value)} /></label>
              <label className="block text-sm">{copy.severity}<Select aria-label={copy.severity} value={severity} disabled={locked || busy} className="block" options={["P0","P1","P2","P3"].map((value) => ({ value, label: value }))} onChange={setSeverity} /></label>
              <Button type="primary" loading={busy || state.phase === "sending"} disabled={!basis.can_intake || locked || busy || !draft || !validOpsIntakeOriginal(draft)} onClick={() => void submit()}>{copy.create}</Button>
            </>}
            <details><summary>{copy.details}</summary><p className="break-all text-xs">{basis.source_id} · {basis.source_digest}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(basis.snapshot, null, 2)}</pre></details>
          </>}
        </>}
        {latest && <Alert type="warning" title={copy.changed} action={<Button disabled={busy || locked} onClick={() => { if (!current() || latch.current || command.locked) return; setBasis(structuredClone(latest)); setLatest(undefined); setError(""); }}>{copy.adopt}</Button>} />}
        {original && ["sending", "unknown", "succeeded"].includes(state.phase) && <Button onClick={() => {
          if (!current() || !validOpsIntakeOriginal(command.snapshot().original) || !["sending", "unknown", "succeeded"].includes(command.snapshot().phase)) return;
          setDeferred(true); setShowRecovery(false); onClose();
        }}>{copy.defer}</Button>}
        <Button disabled={locked || busy} onClick={close}>{copy.close}</Button>
      </div>
    </Modal>
  </>;
}
