import { Alert, Button, Input, Select, Space, Steps, Tag } from "antd";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { api } from "@/lib/api";
import { bindSessionRequest } from "@/lib/http";
import { getProjectId, getSessionRevision, USER_KEY } from "@/lib/authStorage";
import { eventHash } from "@/lib/eventReceipts";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  sameExecutionLocation,
  useExecutionExitGuard,
} from "@/lib/executionExitGuard";
import {
  assetDraftKey,
  assetSyncBlocksExit,
  assetTarget,
  createAssetSyncController,
  type AssetIdentity,
} from "@/lib/assetSync";

function currentIdentity(): AssetIdentity | null {
  try {
    const user = JSON.parse(localStorage.getItem(USER_KEY) || "null");
    const projectId = getProjectId(),
      revision = getSessionRevision();
    return user?.id && user?.tenant_id && projectId && revision
      ? { tenantId: user.tenant_id, userId: user.id, projectId, revision }
      : null;
  } catch {
    return null;
  }
}

type PendingChange = (pending: boolean, canNavigate: () => boolean) => void;
export function AssetSyncWorkbench({
  onPending,
}: {
  onPending?: PendingChange;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t("assetSync." + key);
  const [generation, setGeneration] = useState(0);
  const scope = projectSessionKey();
  const identity = currentIdentity();
  const controller = useMemo(() => {
    if (!identity) return null;
    const key = assetDraftKey(identity);
    const send = bindSessionRequest(identity);
    return createAssetSyncController({
      identity,
      scope,
      currentScope: projectSessionKey,
      load: () => sessionStorage.getItem(key),
      save: (value) => sessionStorage.setItem(key, value),
      send: (body) => api.syncPush(body, send),
    });
    // Session notifications invalidate the old gate even during A → B → A batching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, generation]);
  useEffect(() => {
    controller?.activate();
    const changed = () => {
      controller?.invalidate();
      setGeneration((value) => value + 1);
    };
    window.addEventListener("sop-session", changed);
    window.addEventListener("storage", changed);
    const enteredHref = window.location.href;
    const leave = () => {
      if (!sameExecutionLocation(enteredHref, window.location.href))
        controller?.invalidate();
    };
    window.addEventListener("hashchange", leave);
    window.addEventListener("popstate", leave);
    return () => {
      window.removeEventListener("sop-session", changed);
      window.removeEventListener("storage", changed);
      window.removeEventListener("hashchange", leave);
      window.removeEventListener("popstate", leave);
      controller?.invalidate();
    };
  }, [controller]);
  return (
    <Card title={tr("title")}>
      {controller && identity ? (
        <AssetSyncForm
          key={scope + generation}
          controller={controller}
          projectId={identity.projectId}
          onPending={onPending}
        />
      ) : (
        <Alert type="info" title={tr("identityRequired")} />
      )}
    </Card>
  );
}

export function AssetSyncForm({
  controller,
  projectId,
  onPending,
}: {
  controller: ReturnType<typeof createAssetSyncController>;
  projectId: string;
  onPending?: PendingChange;
}) {
  const { t } = useTranslation();
  const exit = useExecutionExitGuard();
  const tr = (key: string) => t("assetSync." + key);
  const pending = useRef(onPending);
  pending.current = onPending;
  const subscribe = useMemo(
    () => (notify: () => void) =>
      controller.subscribe(() => {
        const blocked = assetSyncBlocksExit(controller.snapshot().phase);
        exit.setPending("asset-sync", blocked);
        pending.current?.(blocked, exit.canNavigate);
        notify();
      }),
    [controller, exit.setPending, exit.canNavigate],
  );
  const state = useSyncExternalStore(
    subscribe,
    controller.snapshot,
    controller.snapshot,
  );
  useEffect(() => {
    const blocked = assetSyncBlocksExit(controller.snapshot().phase);
    exit.setPending("asset-sync", blocked);
    pending.current?.(blocked, exit.canNavigate);
    return () => pending.current?.(false, exit.canNavigate);
  }, [controller, exit.setPending, exit.canNavigate]);
  const { draft, phase, command, ack } = state;
  const editable = phase === "editing";
  const busy = phase === "sending";
  const error = state.error;
  const knownErrors = [
    "invalidPath",
    "invalidVersion",
    "invalidSha",
    "invalidContent",
    "invalidKey",
    "storageInvalid",
    "storageUnavailable",
    "ackMismatch",
  ];
  const stage = editable ? 0 : phase === "review" ? 1 : 2;
  return (
    <section className="min-w-0 space-y-4" aria-label={tr("title")}>
      <p className="text-sm leading-6 text-[var(--text-muted)]">
        {tr("intro")}
      </p>
      <Steps
        size="small"
        current={stage}
        items={[
          { title: tr("prepare") },
          { title: tr("review") },
          { title: tr("delivery") },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <span>{tr("project")}</span>
        <code className="break-all">{projectId}</code>
        {!editable && (
          <Tag
            color={
              phase === "processed"
                ? "green"
                : phase === "failed" || phase === "rejected"
                  ? "red"
                  : "blue"
            }
          >
            {tr(phase)}
          </Tag>
        )}
      </div>
      {phase === "unknown" && (
        <Alert
          type="warning"
          showIcon
          title={tr("unknown")}
          description={tr("unknownHint")}
        />
      )}
      {exit.blocked && (
        <Alert type="warning" role="alert" title={tr("unknownHint")} />
      )}
      {phase === "stored" && (
        <Alert
          type="info"
          showIcon
          title={tr("stored")}
          description={tr("storedHint")}
        />
      )}
      {phase === "processed" && (
        <Alert
          type="success"
          showIcon
          title={tr("processed")}
          description={tr("processedHint")}
        />
      )}
      {phase === "failed" && (
        <Alert
          type="error"
          showIcon
          title={tr("failed")}
          description={ack?.processing?.reason_code || tr("failedHint")}
        />
      )}
      {phase === "rejected" && (
        <Alert
          type="warning"
          showIcon
          title={tr("rejected")}
          description={tr("rejectedHint")}
        />
      )}
      {editable ? (
        <div className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span>{tr("module")}</span>
            <Select
              className="w-full"
              aria-label={tr("module")}
              value={draft.module}
              options={["rules", "specs", "templates"].map((value) => ({
                value,
                label: value,
              }))}
              onChange={(module) => controller.patch({ module })}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>{tr("path")}</span>
            <Input
              aria-label={tr("path")}
              value={draft.path}
              maxLength={1024}
              onChange={(event) =>
                controller.patch({ path: event.target.value })
              }
            />
          </label>
          <p className="break-all text-xs text-[var(--text-muted)]">
            {tr("target")} <code>{assetTarget(draft)}</code>
          </p>
          <label className="block space-y-1 text-sm">
            <span>{tr("content")}</span>
            <Input.TextArea
              aria-label={tr("content")}
              rows={7}
              className="font-mono text-xs"
              value={draft.content}
              onChange={(event) =>
                controller.patch({ content: event.target.value })
              }
            />
            <span className="block text-xs leading-5 text-[var(--text-muted)]">
              {tr("contentLimit")}
            </span>
          </label>
          <fieldset className="min-w-0 space-y-3 rounded-lg border border-[var(--border)] p-3">
            <legend className="px-1 text-sm font-medium">{tr("basis")}</legend>
            <p className="text-xs leading-5 text-[var(--text-muted)]">
              {tr("basisHint")}
            </p>
            <label className="block space-y-1 text-sm">
              <span>{tr("version")}</span>
              <Input
                aria-label={tr("version")}
                inputMode="numeric"
                placeholder={tr("versionPlaceholder")}
                value={draft.version}
                onChange={(event) =>
                  controller.patch({ version: event.target.value })
                }
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span>{tr("fileBasis")}</span>
              <Select
                className="w-full"
                aria-label={tr("fileBasis")}
                value={draft.basis}
                options={[
                  { value: "existing", label: tr("existing") },
                  { value: "absent", label: tr("absent") },
                ]}
                onChange={(basis) => controller.patch({ basis })}
              />
            </label>
            {draft.basis === "existing" ? (
              <label className="block space-y-1 text-sm">
                <span>{tr("sha")}</span>
                <Input
                  aria-label={tr("sha")}
                  className="font-mono text-xs"
                  value={draft.sha}
                  maxLength={64}
                  onChange={(event) =>
                    controller.patch({ sha: event.target.value })
                  }
                />
              </label>
            ) : (
              <Alert type="warning" title={tr("absentHint")} />
            )}
          </fieldset>
        </div>
      ) : (
        command && (
          <div className="space-y-2">
            <p className="text-sm leading-6 text-[var(--text-muted)]">
              {tr("frozenHint")}
            </p>
            <pre
              tabIndex={0}
              aria-label={tr("original")}
              className="max-h-96 max-w-full overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100"
            >
              {JSON.stringify(command.body, null, 2)}
            </pre>
          </div>
        )
      )}
      {error && (
        <Alert
          type="error"
          role="alert"
          title={tr("error")}
          description={knownErrors.includes(error) ? tr(error) : error}
        />
      )}
      {ack && (
        <div
          className="space-y-1 break-all text-xs text-[var(--text-muted)]"
          role="status"
        >
          <p>
            {tr("receipt")}: <code>{ack.receipt_id}</code>
          </p>
          <p>
            {tr("event")}: <code>{ack.id}</code>
          </p>
          <p>
            {tr("digest")}: <code>{ack.digest}</code>
          </p>
          {ack.processing?.state === "processed" && (
            <p>
              {tr("actualTarget")}:{" "}
              <code>{String(ack.processing.result?.target_id)}</code>
            </p>
          )}
          <p>
            {tr("deliveryState")}: {tr("stored")} · {tr("processingState")}:{" "}
            {ack.processing
              ? tr(
                  ack.processing.state === "pending"
                    ? "processingPending"
                    : ack.processing.state,
                )
              : tr("unconfigured")}
          </p>
        </div>
      )}
      <Space wrap>
        {editable && (
          <Button type="primary" onClick={() => void controller.review()}>
            {tr("review")}
          </Button>
        )}
        {phase === "review" && (
          <>
            <Button onClick={() => controller.editReview()}>
              {tr("edit")}
            </Button>
            <Button type="primary" onClick={() => void controller.submit()}>
              {tr("confirm")}
            </Button>
          </>
        )}
        {phase === "unknown" && command && (
          <Button type="primary" onClick={() => void controller.submit()}>
            {tr("replay")}
          </Button>
        )}
        {busy && (
          <Button loading disabled>
            {tr("sending")}
          </Button>
        )}
        {(phase === "stored" || phase === "failed") && (
          <Button onClick={() => void controller.submit()}>
            {tr("refreshOriginal")}
          </Button>
        )}
        {ack && (
          <Button
            href={eventHash(projectId, { receipt: ack.receipt_id })}
            disabled={busy || phase === "unknown"}
          >
            {tr("openReceipt")}
          </Button>
        )}
        {["processed", "failed", "rejected"].includes(phase) && (
          <Button onClick={() => controller.newDraft()}>
            {tr("newBasis")}
          </Button>
        )}
      </Space>
    </section>
  );
}
