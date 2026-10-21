import { Alert, Button, Input, Select, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownView } from "@/components/MarkdownView";
import { designCopy, designReason } from "@/i18n/design-library";
import { useDesignGeneration, type DesignGeneration, type DesignGenerationInput } from "@/lib/designGeneration";
import type { DesignRevisionView } from "@/lib/designLibrary";

export function DesignGenerationPanel({ projectId, source, disabled, canGenerate, canStart, onSave, onPending }: { projectId: string; source: DesignRevisionView; disabled: boolean; canGenerate: boolean; canStart: () => boolean; onSave: (value: DesignGeneration) => void; onPending: (pending: boolean) => void }) {
  const { i18n } = useTranslation(), copy = designCopy(i18n?.language), command = useDesignGeneration(projectId, source.document_id);
  const [mode, setMode] = useState<DesignGenerationInput["mode"]>("expand"), [instructions, setInstructions] = useState("");
  const state = command.state, locked = ["sending", "unknown"].includes(state.phase), value = state.view;
  const access = useRef({ disabled, canGenerate, canStart }); access.current = { disabled, canGenerate, canStart };
  const notify = useRef(onPending); notify.current = onPending;
  useEffect(() => { notify.current(locked); return () => notify.current(false); }, [locked]);
  const fresh = () => command.current() && !access.current.disabled && access.current.canGenerate && access.current.canStart() && !["sending", "unknown"].includes(command.snapshot().phase);
  const generate = async () => {
    if (!fresh() || mode === "free" && !instructions.trim()) return;
    if (["known", "refused"].includes(command.snapshot().phase)) { command.reset(); if (command.snapshot().phase !== "idle") return; }
    await command.run({ document_id: source.document_id, body: { base_revision_id: source.revision.id, base_revision_digest: source.revision.digest, mode, instructions, idempotency_key: crypto.randomUUID() } });
  };
  return <section className="space-y-3 rounded-lg border border-[var(--border)] p-3" aria-label={copy.ai}><strong>{copy.ai}</strong><p className="runtime-help">{copy.suggestionOnly}</p>
    <Select aria-label={copy.ai} className="w-full" value={mode} disabled={disabled || locked} options={(["expand", "review", "diagram", "free"] as const).map((item) => ({ value: item, label: copy[item] }))} onChange={(next) => { if (!locked && command.current()) setMode(next); }} />
    <label className="block">{copy.instructions}<Input.TextArea aria-label={copy.instructions} rows={3} maxLength={4000} value={instructions} disabled={disabled || locked} onChange={(event) => { if (!locked && command.current()) setInstructions(event.target.value); }} /></label>
    {state.error && <Alert type="warning" title={copy.failed} description={state.error === "retainedOriginalUnavailable" ? copy.storage : state.error === "retainedOriginalInvalid" || state.error === "designInvalid" ? copy.invalid : state.error} />}
    <Space wrap><Button disabled={disabled || !canGenerate || locked || mode === "free" && !instructions.trim()} loading={state.phase === "sending"} onClick={() => void generate()}>{value || state.phase === "refused" ? copy.regenerate : copy.generate}</Button>{state.phase === "unknown" && state.original && <Button data-action="recover-design-generation" onClick={() => { if (command.current() && command.snapshot().phase === "unknown") void command.replay(); }}>{copy.replay}</Button>}{state.phase === "known" && <Button onClick={() => void command.refresh()}>{copy.refresh}</Button>}</Space>
    {state.phase === "unknown" && <Alert type="warning" role="status" title={copy.unknown} description={copy.recovery} />}
    {value && <><p className="runtime-help">{value.provider} · {value.model} · {value.created_at}</p>{value.status === "generating" && <Alert type="info" role="status" title={copy.generating} />}{value.status === "failed" && <Alert type="warning" title={copy.failed} description={value.error && <>{designReason(i18n?.language, value.error)}<details className="runtime-help"><summary>{copy.details}</summary><code>{value.error.code}</code><p>{value.error.message}</p></details></>} />}{value.content && <details open><summary>{copy.ai}</summary><MarkdownView content={value.content} /></details>}
      <Button disabled={disabled || !canGenerate || locked || !value.can_save || value.base_revision_id !== source.revision.id || value.base_revision_digest !== source.revision.digest} onClick={() => { const latest = command.snapshot().view; if (!fresh() || !latest?.can_save || latest.status !== "succeeded" || latest.base_revision_id !== source.revision.id || latest.base_revision_digest !== source.revision.digest) return; onSave(latest); }}>{copy.saveSuggestion}</Button>
      {value.reasons.length > 0 && <ul className="runtime-help">{value.reasons.map((item) => <li key={item.code}>{designReason(i18n?.language, item)}</li>)}</ul>}
      <details className="runtime-help"><summary>{copy.details}</summary><p>{value.id} · {value.request_key}</p><p className="break-all">{value.base_revision_digest}</p><pre>{JSON.stringify(value.usage, null, 2)}</pre>{value.reasons.map((item) => <p key={item.code}><code>{item.code}</code> · {item.message}</p>)}</details></>}
  </section>;
}
