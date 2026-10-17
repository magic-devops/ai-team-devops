import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/Card";
import { api } from "@/lib/api";
import { getProjectId, getSessionRevision } from "@/lib/authStorage";
import { fetchDelivery } from "@/lib/delivery";
import {
  assistanceError,
  assistanceIntent,
  selectedIntakeItems,
  type AssistanceIntent,
  type AssistancePreview,
  type AssistanceSource,
  type IntakeRow,
} from "@/lib/requirementsAssistance";
import {
  AssistanceConflict,
  AssistanceField,
  AssistanceSourceSelect,
  GenerationMetadata,
  assistanceButton,
  assistanceField,
  assistancePrimary,
} from "./AssistanceControls";

type IntakePreview = AssistancePreview & {
  items?: Array<Omit<IntakeRow, "key" | "selected">>;
  count?: number;
};

export function RequirementIntake({ onImported }: { onImported: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({
    text: "",
    filename: "requirements.md",
    mode: "prd",
    agent: "Product Analyst Agent",
    cli: "codex",
    assigned_agent: "",
    dev_tool: "",
    auto_priority: true,
    auto_acceptance: true,
  });
  const [source, setSource] = useState<AssistanceSource>("ai");
  const [preview, setPreview] = useState<IntakePreview>();
  const [previewInput, setPreviewInput] = useState("");
  const [rows, setRows] = useState<IntakeRow[]>([]);
  const [version, setVersion] = useState<number>();
  const [latest, setLatest] = useState<number>();
  const [error, setError] = useState<ReturnType<typeof assistanceError>>();
  const [errorStage, setErrorStage] = useState("");
  const [busy, setBusy] = useState<"generate" | "import" | "latest" | "">("");
  const [imported, setImported] = useState<number>();
  const inFlight = useRef(false);
  const intents = useRef<Record<string, AssistanceIntent>>({});
  const projectId = getProjectId() || "";
  const scope = `${getSessionRevision()}:${projectId}`;
  const fingerprint = JSON.stringify(draft);
  const changed = Boolean(preview && previewInput !== fingerprint);
  const selected = selectedIntakeItems(rows);
  const setRow = (key: string, patch: Partial<IntakeRow>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  const keyFor = (action: string, body: unknown, regenerate = false) => {
    const intent = assistanceIntent(
      intents.current[action],
      scope,
      action,
      body,
      regenerate,
    );
    intents.current[action] = intent;
    return intent.key;
  };
  async function generate(regenerate = false) {
    if (inFlight.current) return;
    if (draft.text.trim().length < 20) {
      setError({
        message: t("assistance.inputEmpty"),
        conflict: false,
        stale: false,
      });
      return;
    }
    inFlight.current = true;
    setBusy("generate");
    setErrorStage("generate");
    setError(undefined);
    setImported(undefined);
    const body = { ...draft, generator: source };
    try {
      const data = (await api.parseRequirementsDocument({
        ...body,
        idempotency_key: keyFor("parse", body, regenerate),
      })) as IntakePreview;
      setPreview(data);
      setPreviewInput(fingerprint);
      setVersion(data.expected_version);
      setLatest(undefined);
      setRows(
        (data.items || []).map((item, index) => ({
          ...item,
          key: `${data.generation?.id || "preview"}-${index}`,
          selected: true,
        })),
      );
    } catch (cause) {
      setError(assistanceError(cause));
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }
  async function importDrafts() {
    if (
      inFlight.current ||
      changed ||
      !preview?.generation ||
      version == null ||
      !selected.length ||
      selected.some((row) => !row.title)
    )
      return;
    inFlight.current = true;
    setBusy("import");
    setErrorStage("import");
    setError(undefined);
    setImported(undefined);
    const body = {
      items: selected,
      generation_id: preview.generation.id,
      expected_version: version,
    };
    try {
      const data = await api.batchCreateRequirements({
        ...body,
        idempotency_key: keyFor("import", body),
      });
      setImported(Number(data.count ?? selected.length));
      setRows((current) => current.map((row) => ({ ...row, selected: false })));
      onImported();
    } catch (cause) {
      setError(assistanceError(cause));
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }
  async function loadLatest() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("latest");
    try {
      setLatest((await fetchDelivery(projectId)).version);
    } catch (cause) {
      setError(assistanceError(cause));
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }
  return (
    <Card title={t("assistance.parseTitle")}>
      <p className="mb-4 text-sm text-[var(--muted)]">
        {t("assistance.parseHint")}
      </p>
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <AssistanceSourceSelect
            source={source}
            onChange={setSource}
            disabled={Boolean(busy)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <AssistanceField label={t("assistance.mode")}>
              <select
                className={assistanceField}
                value={draft.mode}
                disabled={Boolean(busy)}
                onChange={(e) => setDraft({ ...draft, mode: e.target.value })}
              >
                {[
                  "idea",
                  "prd",
                  "meeting",
                  "feedback",
                  "incident",
                  "data",
                  "mixed",
                ].map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`assistance.modeMap.${mode}`)}
                  </option>
                ))}
              </select>
            </AssistanceField>
            <AssistanceField label={t("assistance.filename")}>
              <input
                className={assistanceField}
                value={draft.filename}
                disabled={Boolean(busy)}
                onChange={(e) =>
                  setDraft({ ...draft, filename: e.target.value })
                }
              />
            </AssistanceField>
            <AssistanceField label={t("assistance.owner")}>
              <input
                className={assistanceField}
                value={draft.assigned_agent}
                disabled={Boolean(busy)}
                onChange={(e) =>
                  setDraft({ ...draft, assigned_agent: e.target.value })
                }
              />
            </AssistanceField>
            <AssistanceField label={t("assistance.tool")}>
              <input
                className={assistanceField}
                value={draft.dev_tool}
                disabled={Boolean(busy)}
                onChange={(e) =>
                  setDraft({ ...draft, dev_tool: e.target.value })
                }
              />
            </AssistanceField>
          </div>
          <AssistanceField label={t("assistance.text")}>
            <textarea
              className={`${assistanceField} min-h-56 resize-y`}
              maxLength={60000}
              value={draft.text}
              disabled={Boolean(busy)}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
          </AssistanceField>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${assistanceButton} cursor-pointer`}>
              {t("assistance.file")}
              <input
                type="file"
                className="max-w-44 text-xs"
                accept=".md,.txt,.csv,.json"
                disabled={Boolean(busy)}
                onChange={async (event) => {
                  const target = event.currentTarget;
                  const file = target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    setDraft((current) => ({
                      ...current,
                      filename: file.name,
                      text: text.slice(0, 60000),
                    }));
                  } catch (cause) {
                    setError(assistanceError(cause));
                  }
                  target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              className={assistancePrimary}
              disabled={Boolean(busy) || draft.text.trim().length < 20}
              onClick={() => void generate(false)}
            >
              {busy === "generate"
                ? t("assistance.busy")
                : error
                  ? t("assistance.retry")
                  : t("assistance.generate")}
            </button>
            {(preview || intents.current.parse) && (
              <button
                type="button"
                className={assistanceButton}
                disabled={Boolean(busy)}
                onClick={() => void generate(true)}
              >
                {t("assistance.regenerate")}
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="space-y-2 text-sm text-rose-600">
              <p>{error.message}</p>
              {errorStage === "generate" && (
                <p className="text-xs text-[var(--muted)]">
                  {t("assistance.previous")}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          <GenerationMetadata generation={preview?.generation} />
          {changed && (
            <p
              role="alert"
              className="rounded-lg bg-amber-500/10 p-3 text-sm text-[var(--text)]"
            >
              {t("assistance.editedInput")}
            </p>
          )}
          {error?.conflict && (
            <AssistanceConflict
              latest={latest}
              stale={false}
              loading={busy === "latest"}
              onLoad={() => void loadLatest()}
              onAdopt={() => {
                if (latest != null) {
                  setVersion(latest);
                  setLatest(undefined);
                  setError(undefined);
                }
              }}
            />
          )}
          {imported != null && (
            <p
              role="status"
              className="rounded-lg bg-emerald-500/10 p-3 text-sm"
            >
              {t("assistance.imported", { count: imported })}
            </p>
          )}
          {!preview && (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">
              {t("assistance.noPreview")}
            </div>
          )}
          {preview && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {t("assistance.draft")} ·{" "}
                  {t("assistance.selected", { count: selected.length })}
                </h3>
                <div className="flex gap-2">
                  <button
                    className={assistanceButton}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      setRows((current) =>
                        current.map((row) => ({ ...row, selected: true })),
                      )
                    }
                  >
                    {t("assistance.selectAll")}
                  </button>
                  <button
                    className={assistanceButton}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      setRows((current) =>
                        current.map((row) => ({ ...row, selected: false })),
                      )
                    }
                  >
                    {t("assistance.clearSelection")}
                  </button>
                </div>
              </div>
              <div className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
                {rows.map((row, index) => (
                  <fieldset
                    key={row.key}
                    className="min-w-0 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
                    disabled={Boolean(busy)}
                  >
                    <legend className="px-1 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) =>
                            setRow(row.key, { selected: e.target.checked })
                          }
                        />
                        {index + 1}. {row.title || t("assistance.title")}
                      </label>
                    </legend>
                    <AssistanceField label={t("assistance.title")}>
                      <input
                        className={assistanceField}
                        value={row.title}
                        required
                        onChange={(e) =>
                          setRow(row.key, { title: e.target.value })
                        }
                      />
                    </AssistanceField>
                    <AssistanceField label={t("assistance.scope")}>
                      <textarea
                        className={assistanceField}
                        rows={3}
                        value={row.description || ""}
                        onChange={(e) =>
                          setRow(row.key, { description: e.target.value })
                        }
                      />
                    </AssistanceField>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <AssistanceField label={t("assistance.priority")}>
                        <select
                          className={assistanceField}
                          value={row.priority || "P2"}
                          onChange={(e) =>
                            setRow(row.key, { priority: e.target.value })
                          }
                        >
                          {["P0", "P1", "P2", "P3"].map((priority) => (
                            <option key={priority}>{priority}</option>
                          ))}
                        </select>
                      </AssistanceField>
                      <AssistanceField label={t("assistance.tags")}>
                        <input
                          className={assistanceField}
                          value={row.tags_text ?? (row.tags || []).join(", ")}
                          onChange={(e) =>
                            setRow(row.key, { tags_text: e.target.value })
                          }
                        />
                      </AssistanceField>
                    </div>
                    <AssistanceField label={t("assistance.criteria")}>
                      <textarea
                        className={assistanceField}
                        rows={3}
                        value={
                          row.acceptance_text ??
                          (row.acceptance_criteria || []).join("\n")
                        }
                        onChange={(e) =>
                          setRow(row.key, { acceptance_text: e.target.value })
                        }
                      />
                    </AssistanceField>
                  </fieldset>
                ))}
              </div>
              <div className="sticky bottom-0 border-t border-[var(--border)] bg-[var(--surface)] py-3">
                <button
                  type="button"
                  className={`${assistancePrimary} w-full sm:w-auto`}
                  disabled={
                    Boolean(busy) ||
                    changed ||
                    !preview.generation ||
                    version == null ||
                    !selected.length ||
                    selected.some((item) => !item.title)
                  }
                  onClick={() => void importDrafts()}
                >
                  {busy === "import"
                    ? t("assistance.busy")
                    : t("assistance.import")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
