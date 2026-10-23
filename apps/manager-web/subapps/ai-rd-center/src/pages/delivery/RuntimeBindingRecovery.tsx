import { Alert, Button, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { discoverRuntimeBindingRecovery, RUNTIME_BINDING_CHANGE, validRuntimeBindingAck, validRuntimeBindingOriginal, type RuntimeBindingCommand } from "@/lib/runtimeBindingCommand";
import { runtimeBindingRecoveryCopy } from "@/i18n/runtime-binding-recovery";

export function RuntimeBindingRecovery({ projectId, memberId, command, onSaved, onResolved, onDeferred, isActive }: {
  projectId: string; memberId: string; command: RuntimeBindingCommand; onSaved: (ack: DeliveryCommandAck) => void | Promise<void>;
  onResolved?: () => void; onDeferred?: () => void; isActive?: () => boolean;
}) {
  const { i18n } = useTranslation(), copy = runtimeBindingRecoveryCopy(i18n?.language), state = command.state;
  const pending = useRef(false), mounted = useRef(true), [working, setWorking] = useState(false), [error, setError] = useState("");
  const identity = JSON.stringify([projectId, memberId]), live = useRef(identity); live.current = identity;
  const access = useRef({ command, onSaved, onResolved, onDeferred, isActive }); access.current = { command, onSaved, onResolved, onDeferred, isActive };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && live.current === identity && access.current.command.snapshot === command.snapshot && command.current() && access.current.isActive?.() !== false;
  const finish = async () => {
    if (pending.current || working || !current()) return;
    const saved = command.snapshot();
    if (saved.phase !== "succeeded" || !saved.original || !validRuntimeBindingAck(projectId, memberId, saved.original, saved.ack)) return;
    pending.current = true; setWorking(true); setError("");
    try {
      await access.current.onSaved(saved.ack);
      if (!current()) return;
      command.reset(); if (command.snapshot().phase === "idle") access.current.onResolved?.();
    } catch { if (current()) setError(copy.refreshFailed); }
    finally { pending.current = false; if (mounted.current) setWorking(false); }
  };
  const replay = async () => {
    if (pending.current || working || !current() || command.snapshot().phase !== "unknown") return;
    pending.current = true; setWorking(true); setError("");
    try { await command.replay(); } finally { pending.current = false; if (mounted.current) setWorking(false); }
  };
  const discard = () => {
    if (pending.current || working || !current() || command.snapshot().phase !== "refused") return;
    command.reset(); if (command.snapshot().phase === "idle") access.current.onResolved?.();
  };
  const defer = () => {
    const saved = command.snapshot();
    if (current() && ["sending", "unknown", "succeeded"].includes(saved.phase) && saved.error !== "retainedOriginalUnavailable" && validRuntimeBindingOriginal(saved.original, memberId)) access.current.onDeferred?.();
  };
  if (state.phase === "idle" && !state.error) return null;
  const blocked = !state.original || state.error === "retainedOriginalUnavailable";
  const title = blocked ? copy.blocked : state.phase === "sending" ? copy.pending : state.phase === "succeeded" ? copy.succeeded : state.phase === "refused" ? copy.refused : copy.unknown;
  return <section className="team-runtime-candidate space-y-3" aria-label={copy.title}>
    <Alert role="status" type={state.phase === "succeeded" ? "success" : "warning"} title={title} description={copy.hint} />
    {error && <Alert role="alert" type="error" title={error} />}
    <Space wrap>
      {onDeferred && state.original && !blocked && ["sending", "unknown", "succeeded"].includes(state.phase) && <Button data-action="defer-runtime-binding" disabled={!current()} onClick={defer}>{copy.defer}</Button>}
      {state.phase === "unknown" && state.original && <Button type="primary" data-action="recover-runtime-binding" disabled={!current() || working} loading={working} onClick={replay}>{copy.replay}</Button>}
      {state.phase === "succeeded" && <Button type="primary" data-action="finish-runtime-binding" disabled={!current() || working} onClick={finish}>{copy.finish}</Button>}
      {state.phase === "refused" && <Button data-action="discard-runtime-binding" disabled={!current() || working} onClick={discard}>{copy.discard}</Button>}
      {blocked && !state.original && <Button data-action="reload-runtime-binding" disabled={!current() || working} onClick={() => { if (!pending.current && current()) window.location.reload(); }}>{copy.reload}</Button>}
    </Space>
    {blocked && <p className="runtime-help">{copy.reloadHint}</p>}
    {state.original && <details><summary>{copy.original}</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(state.original, null, 2)}</pre></details>}
    {state.ack && <details><summary>{copy.receipt}</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(state.ack, null, 2)}</pre></details>}
  </section>;
}
export function RuntimeBindingRecoveryIndex({ projectId, onOpen }: { projectId: string; onOpen: (memberId: string) => void }) {
  const { i18n } = useTranslation(), copy = runtimeBindingRecoveryCopy(i18n?.language);
  const [, refresh] = useState(0);
  useEffect(() => {
    const change = () => refresh((value) => value + 1);
    for (const name of [RUNTIME_BINDING_CHANGE, "storage", "sop-session"]) window.addEventListener(name, change);
    return () => { for (const name of [RUNTIME_BINDING_CHANGE, "storage", "sop-session"]) window.removeEventListener(name, change); };
  }, [projectId]);
  let members: string[];
  try { members = discoverRuntimeBindingRecovery(projectId); } catch { return <Alert role="alert" type="warning" title={copy.indexError} />; }
  if (!members.length) return null;
  return <section className="team-runtime-candidate" aria-label={copy.indexTitle}><strong>{copy.indexTitle}</strong><div className="delivery-actions">{members.map((id) => <Button key={id} data-action="open-runtime-binding-recovery" onClick={() => onOpen(id)}>{copy.open} · {id}</Button>)}</div></section>;
}
