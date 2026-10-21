import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownView } from "@/components/MarkdownView";
import { designCopy } from "@/i18n/design-library";
import { api } from "@/lib/api";
import { getProjectId, getSessionRevision } from "@/lib/authStorage";
import {
  assistanceApplyBody,
  assistanceError,
  assistanceIntent,
  canAdoptAssistanceVersion,
  prototypeModes,
  type PrototypeMode,
  type AssistanceGeneration,
  type AssistanceIntent,
  type AssistancePreview,
  type AssistanceSource,
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

type Mode = "review" | "prototype";
type PreviewState = {
  result?: AssistancePreview;
  version?: number;
  criteria: string;
  content: string;
  title: string;
  notes: string;
  latest?: number;
  stale: boolean;
  error?: ReturnType<typeof assistanceError>;
  saved: boolean;
  savedArtifact?: { id: string; content: string };
};
type History = {
  expected_version: number;
  requirement_basis: string;
  items: Array<{
    generation: AssistanceGeneration;
    status: string;
    result?: AssistancePreview;
    error?: { status?: number; detail?: unknown };
  }>;
};
const emptyState = (): PreviewState => ({
  criteria: "",
  content: "",
  title: "",
  notes: "",
  stale: false,
  saved: false,
});

export function RequirementAssistance({
  requirementId,
  onApplied,
  onClose,
}: {
  requirementId: string;
  onApplied: () => void;
  onClose?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const designText = designCopy(i18n?.language);
  const [mode, setMode] = useState<Mode>("review");
  const [sources, setSources] = useState<Record<Mode, AssistanceSource>>({
    review: "rules",
    prototype: "ai",
  });
  const [drafts, setDrafts] = useState<Record<Mode, PreviewState>>({
    review: emptyState(),
    prototype: emptyState(),
  });
  const [context, setContext] = useState("");
  const [prototypeMode, setPrototypeMode] =
    useState<PrototypeMode>("wireframe");
  const [busy, setBusy] = useState("");
  const inFlight = useRef(false);
  const intents = useRef<Record<string, AssistanceIntent>>({});
  const scope = `${getSessionRevision()}:${getProjectId()}:${requirementId}`;
  const history = useQuery({
    queryKey: ["requirement-assistance", scope],
    queryFn: () =>
      api.requirementAssistanceHistory(requirementId) as Promise<History>,
  });
  const state = drafts[mode];
  const source = sources[mode];
  const patch = (update: Partial<PreviewState>, target = mode) =>
    setDrafts((current) => ({
      ...current,
      [target]: { ...current[target], ...update },
    }));
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
  function receive(result: AssistancePreview, target: Mode, restored = false) {
    const stale = Boolean(
      result.generation?.stale ||
      (restored &&
        result.generation &&
        history.data &&
        !canAdoptAssistanceVersion(
          result.generation,
          history.data.requirement_basis,
        )),
    );
    patch(
      {
        result,
        version: result.expected_version,
        criteria: (result.suggested_acceptance_criteria || []).join("\n"),
        content: result.content || result.markdown || "",
        title: target === "prototype" ? t("assistance.prototype") : "",
        stale,
        latest: undefined,
        saved: false,
        savedArtifact: undefined,
        error:
          restored || stale
            ? {
                message: t(
                  stale
                    ? "assistance.previewNotCurrent"
                    : "assistance.conflict",
                ),
                conflict: true,
                stale,
              }
            : undefined,
      },
      target,
    );
  }
  async function generate(regenerate = false) {
    if (inFlight.current) return;
    const target = mode;
    inFlight.current = true;
    setBusy("generate");
    patch({ error: undefined, saved: false });
    const body =
      target === "review"
        ? { generator: source }
        : {
            generator: source,
            mode: prototypeMode,
            extra_context: context,
            gen_image: false as const,
          };
    try {
      const idempotency_key = keyFor(`${target}:generate`, body, regenerate);
      const result =
        target === "review"
          ? await api.reviewRequirement(requirementId, {
              ...body,
              idempotency_key,
            })
          : await api.previewRequirementPrototype(requirementId, {
              generator: source,
              mode: prototypeMode,
              extra_context: context,
              gen_image: false,
              idempotency_key,
            });
      receive(result as AssistancePreview, target);
      void history.refetch();
    } catch (cause) {
      patch({ error: assistanceError(cause) }, target);
      void history.refetch();
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }
  async function apply() {
    if (
      inFlight.current ||
      !state.result?.generation ||
      state.version == null ||
      state.stale ||
      state.saved
    )
      return;
    if (
      (mode === "review" && !state.criteria.trim()) ||
      (mode === "prototype" && !state.content.trim())
    )
      return;
    const target = mode;
    inFlight.current = true;
    setBusy("apply");
    patch({ error: undefined });
    const payload =
      mode === "review"
        ? {
            acceptance_criteria: state.criteria
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter(Boolean),
            human_notes: state.notes.trim() || undefined,
          }
        : {
            content: state.content.trim(),
            title: state.title.trim() || t("assistance.prototype"),
          };
    const raw = {
      ...payload,
      generation_id: state.result.generation.id,
      requirement_basis: state.result.generation.basis,
      expected_version: state.version,
    };
    const body = assistanceApplyBody(
      state.result.generation,
      state.version,
      keyFor(`${mode}:apply`, raw),
      payload,
    );
    try {
      if (mode === "review")
        await api.applyRequirementReview(requirementId, body);
      else {
        const result = await api.applyRequirementPrototype(
          requirementId,
          body as {
            content: string;
            title?: string;
            generation_id: string;
            requirement_basis?: string;
            expected_version: number;
            idempotency_key: string;
          },
        );
        if (typeof result?.artifact_id !== "string" || !result.artifact_id.trim() || typeof result.content !== "string") throw new Error(designText.invalid);
        patch({ savedArtifact: { id: result.artifact_id, content: result.content } }, target);
      }
      patch({ saved: true }, target);
      onApplied();
      void history.refetch();
    } catch (cause) {
      patch(
        { error: assistanceError(cause), stale: assistanceError(cause).stale },
        target,
      );
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }
  async function loadLatest() {
    if (inFlight.current || !state.result?.generation) return;
    const target = mode;
    const generation = state.result.generation;
    inFlight.current = true;
    setBusy("latest");
    try {
      const result = await history.refetch();
      if (result.error) throw result.error;
      if (!result.data) return;
      const stale = !canAdoptAssistanceVersion(
        generation,
        result.data.requirement_basis,
      );
      patch({ latest: result.data.expected_version, stale }, target);
    } catch (cause) {
      patch({ error: assistanceError(cause) }, target);
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }
  return (
    <section
      className="mt-4 min-w-0 space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 sm:p-4"
      aria-label={t("assistance.reviewWorkspace")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t("assistance.reviewWorkspace")}
        >
          {(["review", "prototype"] as const).map((tab) => (
            <button
              type="button"
              aria-pressed={mode === tab}
              key={tab}
              className={mode === tab ? assistancePrimary : assistanceButton}
              disabled={Boolean(busy)}
              onClick={() => setMode(tab)}
            >
              {t(`assistance.${tab}`)}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            className={assistanceButton}
            type="button"
            disabled={Boolean(busy)}
            onClick={onClose}
          >
            {t("assistance.close")}
          </button>
        )}
      </div>
      <p className="text-xs leading-5 text-[var(--muted)]">
        {t(`assistance.${mode}Hint`)}
      </p>
      <AssistanceSourceSelect
        source={source}
        onChange={(next) =>
          setSources((current) => ({ ...current, [mode]: next }))
        }
        disabled={Boolean(busy)}
      />
      {mode === "prototype" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <AssistanceField label={t("assistance.prototypeMode")}>
            <select
              className={assistanceField}
              value={prototypeMode}
              disabled={Boolean(busy)}
              onChange={(e) =>
                setPrototypeMode(e.target.value as PrototypeMode)
              }
            >
              {prototypeModes.map((value) => (
                <option key={value} value={value}>
                  {t(`assistance.prototypeModeMap.${value}`)}
                </option>
              ))}
            </select>
          </AssistanceField>
          <AssistanceField label={t("assistance.prototypeContext")}>
            <textarea
              className={assistanceField}
              value={context}
              disabled={Boolean(busy)}
              onChange={(e) => setContext(e.target.value)}
            />
          </AssistanceField>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={assistancePrimary}
          disabled={Boolean(busy)}
          onClick={() => void generate(false)}
        >
          {busy === "generate"
            ? t("assistance.busy")
            : state.error
              ? t("assistance.retry")
              : mode === "review"
                ? t(
                    source === "ai"
                      ? "assistance.reviewAi"
                      : "assistance.reviewRules",
                  )
                : t("assistance.generate")}
        </button>
        {(state.result || intents.current[`${mode}:generate`]) && (
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
      {state.error && (
        <p role="alert" className="text-sm text-rose-600">
          {state.error.message}
        </p>
      )}
      {state.error && !state.error.conflict && (
        <p className="text-xs text-[var(--muted)]">
          {t("assistance.previous")}
        </p>
      )}
      {state.error?.conflict && (
        <AssistanceConflict
          latest={state.latest}
          stale={state.stale}
          loading={busy === "latest"}
          onLoad={() => void loadLatest()}
          onAdopt={() => {
            if (state.latest != null && !state.stale)
              patch({
                version: state.latest,
                latest: undefined,
                error: undefined,
              });
          }}
        />
      )}
      <GenerationMetadata generation={state.result?.generation} />
      {state.result && (
        <div className="space-y-3">
          {mode === "review" ? (
            <>
              {state.result.score != null && (
                <p className="text-sm font-semibold">
                  {t("assistance.score")}: {state.result.score}/100
                </p>
              )}
              {state.result.risks?.length ||
              state.result.suggestions?.length ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <h4 className="text-xs font-semibold">
                    {t("assistance.risk")}
                  </h4>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    {state.result.risks?.map((risk, index) => (
                      <li key={`r${index}`}>{risk.message}</li>
                    ))}
                    {state.result.suggestions?.map((suggestion, index) => (
                      <li key={`s${index}`}>{suggestion}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <AssistanceField label={t("assistance.criteria")}>
                <textarea
                  className={`${assistanceField} min-h-32`}
                  value={state.criteria}
                  disabled={Boolean(busy) || state.saved}
                  onChange={(e) => patch({ criteria: e.target.value })}
                />
              </AssistanceField>
              <AssistanceField label={t("assistance.notes")}>
                <textarea
                  className={assistanceField}
                  value={state.notes}
                  disabled={Boolean(busy) || state.saved}
                  onChange={(e) => patch({ notes: e.target.value })}
                />
              </AssistanceField>
            </>
          ) : (
            <>
              <AssistanceField label={t("assistance.prototypeTitle")}>
                <input
                  className={assistanceField}
                  value={state.title}
                  disabled={Boolean(busy) || state.saved}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </AssistanceField>
              <AssistanceField label={t("assistance.prototypeContent")}>
                <textarea
                  className={`${assistanceField} min-h-64 font-mono text-xs`}
                  value={state.content}
                  disabled={Boolean(busy) || state.saved}
                  onChange={(e) => patch({ content: e.target.value })}
                />
              </AssistanceField>
              <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <summary className="cursor-pointer text-sm">
                  {t("assistance.preview")}
                </summary>
                <MarkdownView content={state.content} className="mt-3" />
              </details>
            </>
          )}
          {state.saved ? (
            <div><p
              role="status"
              className="rounded-lg bg-emerald-500/10 p-3 text-sm"
            >
              {t("assistance.applied")}
            </p>{state.savedArtifact && <details className="rounded-lg border border-[var(--border)] p-3"><summary>{designText.prototypeSaved}</summary><MarkdownView content={state.savedArtifact.content} /><small>{state.savedArtifact.id}</small></details>}</div>
          ) : (
            <button
              type="button"
              className={`${assistancePrimary} w-full sm:w-auto`}
              disabled={
                Boolean(busy) ||
                state.stale ||
                !state.result.generation ||
                state.version == null ||
                !(mode === "review"
                  ? state.criteria.trim()
                  : state.content.trim())
              }
              onClick={() => void apply()}
            >
              {busy === "apply"
                ? t("assistance.busy")
                : t(
                    mode === "review"
                      ? "assistance.applyReview"
                      : "assistance.applyPrototype",
                  )}
            </button>
          )}
        </div>
      )}
      <details className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t("assistance.history")} ({history.data?.items.length || 0})
        </summary>
        <button
          type="button"
          className={`${assistanceButton} mt-3`}
          disabled={history.isFetching || Boolean(busy)}
          onClick={() => void history.refetch()}
        >
          {t("assistance.historyLoad")}
        </button>
        {history.error && (
          <p role="alert" className="mt-2 text-xs text-rose-600">
            {assistanceError(history.error).message}
          </p>
        )}
        <ol className="mt-3 space-y-3">
          {history.data?.items.map((item) => (
            <li
              key={item.generation.id}
              className="rounded-lg border border-[var(--border)] p-3"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs">
                  {t(
                    `assistance.${item.generation.action === "prototype" ? "prototype" : "review"}`,
                  )}{" "}
                  ·{" "}
                  {t(`assistance.${item.status}`, {
                    defaultValue: item.status,
                  })}
                </span>
                {item.result && (
                  <button
                    type="button"
                    className={assistanceButton}
                    disabled={Boolean(busy)}
                    onClick={() => {
                      const target =
                        item.generation.action === "prototype"
                          ? "prototype"
                          : "review";
                      setMode(target);
                      receive(item.result!, target, true);
                    }}
                  >
                    {t("assistance.restore")}
                  </button>
                )}
              </div>
              <GenerationMetadata generation={item.generation} />
              {item.error && (
                <p className="mt-2 break-words text-xs text-rose-600">
                  {typeof item.error.detail === "string"
                    ? item.error.detail
                    : JSON.stringify(item.error.detail)}
                </p>
              )}
            </li>
          ))}
        </ol>
        {history.isSuccess && !history.data.items.length && (
          <p className="mt-3 text-xs text-[var(--muted)]">
            {t("assistance.historyEmpty")}
          </p>
        )}
      </details>
    </section>
  );
}
