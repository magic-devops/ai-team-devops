import { Alert, Button, Drawer, Input, Select } from "antd";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  prepareReleaseCandidate,
  previewDeliveryRelease,
  releaseProblem,
  fetchReleasePage,
  type DeliveryReleases,
  type ReleaseDraft,
  type ReleaseForm,
  type ReleaseScope,
  type ReleasePreview,
} from "@/lib/deliveryRelease";
import type { DeliveryCommandAck } from "@/lib/delivery";
import { ReleaseReasons, ReleaseSnapshotFacts } from "./DeliveryReleaseFacts";
import { useReleaseCommand } from "@/lib/deliveryReleaseCommand";

export function DeliveryReleaseEditor({
  projectId,
  initial,
  selected,
  onSaved,
  onClose,
  readOnly = false,
  onPending,
}: {
  projectId: string;
  initial: DeliveryReleases;
  selected: ReleaseScope;
  onSaved: (workspace: DeliveryCommandAck) => void;
  onClose: () => void;
  readOnly?: boolean;
  onPending?: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`deliveryRelease.${key}`);
  const origin = useRef(projectSessionKey());
  const command = useReleaseCommand(projectId, "candidate", onPending);
  const [latestPreview, setLatestPreview] = useState<ReleasePreview | null>(
    null,
  );
  const [ciQuery, setCiQuery] = useState(""),
    [ciCursor, setCiCursor] = useState("");
  const ciPage = useQuery({
    queryKey: [
      "delivery-release-ci-picker",
      projectId,
      initial.query_generation,
      ciQuery,
      ciCursor,
    ],
    queryFn: ({ signal }) =>
      fetchReleasePage(
        projectId,
        "evidence",
        { q: ciQuery, cursor: ciCursor },
        signal,
        initial.query_generation,
      ),
    retry: false,
    gcTime: 0,
  });
  const [draft, setDraft] = useState<ReleaseDraft>(() => ({
    projectId,
    form: {
      ...structuredClone(selected),
      version: "",
      environment: "",
      ci_evidence_id: "",
      artifact_url: "",
      release_notes: "",
      rollback_plan: "",
      ...(command.state.original?.action === "release.candidate.create"
        ? (command.state.original.payload as unknown as ReleaseForm)
        : {}),
    },
    preview: null,
    intent: { version: initial.version, key: crypto.randomUUID() },
  }));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const allowed =
    !readOnly && initial.permissions.can_create && !ciPage.isError;
  const locked = command.locked || busy !== "";
  const check = () => {
    if (
      !command.current() ||
      origin.current !== projectSessionKey() ||
      projectId !== draft.projectId
    )
      throw new Error("scopeChanged");
  };
  const showError = (problem: unknown) => {
    const info = releaseProblem(problem);
    setConflict(info.conflict);
    setError(
      t(`deliveryReleaseReasons.${info.code}`, {
        defaultValue: t(`deliveryRelease.${info.message}`, {
          defaultValue: info.message,
        }),
      }),
    );
  };
  const change = (patch: Partial<ReleaseForm>) => {
    if (locked) return;
    setDraft({ ...draft, form: { ...draft.form, ...patch }, preview: null });
    setError("");
    setConflict(false);
  };
  const read = async () => {
    if (busy || command.unresolved || !allowed) return;
    setBusy("preview");
    setError("");
    if (command.state.phase === "idle") setDraft({ ...draft, preview: null });
    try {
      check();
      const preview = await previewDeliveryRelease(projectId, draft.form);
      check();
      if (command.state.phase === "refused") {
        setLatestPreview(preview);
        return;
      }
      setDraft({
        ...draft,
        preview,
        intent: { version: preview.version, key: crypto.randomUUID() },
      });
      setConflict(false);
    } catch (problem) {
      showError(problem);
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    if (busy || command.state.phase !== "idle" || conflict || !allowed) return;
    setBusy("save");
    setError("");
    try {
      check();
      const prepared = prepareReleaseCandidate(draft);
      setDraft(prepared.draft);
      const updated = await command.run({
        action: "release.candidate.create",
        payload: prepared.payload,
        intent: { version: prepared.version, key: prepared.key },
      });
      check();
      if (updated) {
        onSaved(updated);
        onClose();
      }
    } catch (problem) {
      showError(problem);
    } finally {
      setBusy("");
    }
  };
  const fields = [
    ["version", "version", 80],
    ["environment", "environment", 80],
    ["artifact_url", "artifactUrl", 2000],
    ["release_notes", "notes", 10000],
    ["rollback_plan", "rollback", 10000],
  ] as const;
  const evidenceOptions = (ciPage.data?.items || []).map((item) => ({
    value: item.id,
    label: `${item.title} · ${item.commit_sha?.slice(0, 12) || item.id}`,
    disabled: item.passed !== true,
  }));
  if (
    draft.form.ci_evidence_id &&
    !ciPage.data?.items.some((item) => item.id === draft.form.ci_evidence_id)
  )
    evidenceOptions.push({
      value: draft.form.ci_evidence_id,
      label: `${draft.form.ci_evidence_id} · ${tr("retainedSelection")}`,
      disabled: false,
    });
  return (
    <Drawer
      open
      title={tr("create")}
      size="min(940px, 100vw)"
      rootClassName="delivery-release-drawer"
      onClose={() => !busy && !command.unresolved && onClose()}
      mask={{ closable: !busy && !command.unresolved }}
      keyboard={!busy && !command.unresolved}
      footer={
        <div className="delivery-release-actions">
          <Button
            disabled={Boolean(busy) || command.unresolved}
            onClick={onClose}
          >
            {tr("cancel")}
          </Button>
          <Button
            loading={busy === "preview"}
            disabled={Boolean(busy) || command.unresolved || !allowed}
            onClick={read}
          >
            {tr(
              conflict || command.state.phase === "refused"
                ? "readLatest"
                : "preview",
            )}
          </Button>
          <Button
            type="primary"
            loading={busy === "save"}
            disabled={
              Boolean(busy) ||
              command.state.phase !== "idle" ||
              !allowed ||
              conflict ||
              !draft.preview?.allowed ||
              !draft.preview.permissions.can_create
            }
            onClick={save}
          >
            {tr("confirm")}
          </Button>
          {command.state.phase === "unknown" && (
            <Button
              type="primary"
              onClick={async () => {
                const ack = await command.replay();
                if (ack) {
                  onSaved(ack);
                  onClose();
                }
              }}
            >
              {tr("replayOriginal")}
            </Button>
          )}
        </div>
      }
    >
      <div className="delivery-release-editor">
        <Alert type="info" showIcon title={tr("previewHint")} />
        {command.state.error && (
          <Alert
            type="error"
            title={tr(
              command.state.phase === "unknown"
                ? "unknownRequest"
                : "saveFailed",
            )}
            description={t(`deliveryRelease.${command.state.error}`, {
              defaultValue: command.state.error,
            })}
          />
        )}
        {command.state.original && command.unresolved && (
          <pre className="delivery-release-raw">
            {JSON.stringify(command.state.original, null, 2)}
          </pre>
        )}
        {latestPreview && (
          <Alert
            type="info"
            title={tr("latest")}
            action={
              <Button
                onClick={() => {
                  command.reset();
                  setDraft({
                    ...draft,
                    preview: latestPreview,
                    intent: {
                      version: latestPreview.version,
                      key: crypto.randomUUID(),
                    },
                  });
                  setLatestPreview(null);
                  setConflict(false);
                }}
              >
                {tr("adopt")}
              </Button>
            }
          />
        )}
        {error && (
          <Alert
            type="error"
            showIcon
            title={tr(conflict ? "conflict" : "saveFailed")}
            description={error}
          />
        )}
        <section className="delivery-release-selection">
          <strong>{tr("capturedScope")}</strong>
          <p>
            {t("deliveryRelease.scopeCount", {
              requirements: draft.form.requirement_ids.length,
              tasks: draft.form.task_ids.length,
            })}
          </p>
          <p className="delivery-release-id">
            {[...draft.form.requirement_ids, ...draft.form.task_ids].join(
              " · ",
            )}
          </p>
        </section>
        <div className="delivery-release-form-grid">
          {fields.map(([key, label, max]) => (
            <label className={max > 80 ? "is-wide" : ""} key={key}>
              <span>{tr(label)} *</span>
              {max > 2000 ? (
                <Input.TextArea
                  aria-label={tr(label)}
                  value={draft.form[key]}
                  disabled={locked}
                  maxLength={max}
                  rows={3}
                  onChange={(event) => change({ [key]: event.target.value })}
                />
              ) : (
                <Input
                  aria-label={tr(label)}
                  value={draft.form[key]}
                  disabled={locked}
                  maxLength={max}
                  onChange={(event) => change({ [key]: event.target.value })}
                />
              )}
            </label>
          ))}
          <label className="is-wide">
            <span>{tr("chooseEvidence")} *</span>
            <Select
              aria-label={tr("chooseEvidence")}
              value={draft.form.ci_evidence_id}
              onChange={(value: string) => change({ ci_evidence_id: value })}
              disabled={locked}
              showSearch
              filterOption={false}
              onSearch={(query) => {
                setCiQuery(query);
                setCiCursor("");
              }}
              optionFilterProp="label"
              options={[
                { value: "", label: tr("chooseEvidence"), disabled: true },
                ...evidenceOptions,
              ]}
            />
            <p className="delivery-release-meta">{tr("evidencePickerHint")}</p>
            {ciPage.error && (
              <Alert
                type="warning"
                title={tr("readFailed")}
                description={String(ciPage.error)}
              />
            )}
            <div className="delivery-release-pager">
              <Button
                disabled={!ciCursor || locked}
                onClick={() => setCiCursor("")}
              >
                {tr("firstPage")}
              </Button>
              <Button
                disabled={!ciPage.data?.next_cursor || locked}
                onClick={() => setCiCursor(ciPage.data!.next_cursor!)}
              >
                {tr("nextPage")}
              </Button>
            </div>
          </label>
        </div>
        {draft.preview && (
          <section
            aria-label={tr("preview")}
            className="delivery-release-preview"
          >
            <Alert
              type={draft.preview.allowed && !conflict ? "success" : "warning"}
              title={tr(
                draft.preview.allowed && !conflict ? "allowed" : "blocked",
              )}
            />
            <ReleaseReasons
              reasons={draft.preview.reasons}
              background={location.hash}
            />
            {draft.preview.snapshot && (
              <ReleaseSnapshotFacts
                snapshot={draft.preview.snapshot}
                background={location.hash}
              />
            )}
          </section>
        )}
      </div>
    </Drawer>
  );
}
