import { Alert, Button } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { projectSessionKey } from "@/lib/projectPortfolio";
import {
  discussionSource,
  fetchDiscussion,
  fetchDiscussionMessage,
  type DiscussionAdoption,
} from "@/lib/deliveryDiscussions";
import { discussionThreadHref } from "@/lib/deliveryDiscussionNavigation";
import {
  DiscussionProblem,
  DiscussionSourceCard,
} from "./DeliveryDiscussionCommon";
export function useDiscussionAdoptionSource(initial?: DiscussionAdoption) {
  const [value, setValue] = useState(initial),
    [latest, setLatest] = useState<DiscussionAdoption | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const current = useRef(value);
  current.current = value;
  const origin = useRef(projectSessionKey()),
    serial = useRef(0);
  useEffect(
    () => () => {
      serial.current++;
    },
    [],
  );
  const change = (next: DiscussionAdoption | undefined) => {
    current.current = next;
    setValue(next);
  };
  async function load(projectId: string) {
    const source = current.current;
    if (!source) return;
    const id = ++serial.current;
    setBusy(true);
    setLatest(null);
    setError(undefined);
    try {
      const detail = await fetchDiscussion(
        projectId,
        source.reference.thread_id,
      );
      const resolution = detail.thread.current_resolution;
      if (!resolution) throw new Error("discussion_source_changed");
      const result = await fetchDiscussionMessage(
        projectId,
        detail.thread.id,
        resolution.message_id,
      );
      if (result.thread_version !== detail.thread.version)
        throw new Error("discussion_source_changed");
      const reference = discussionSource(detail.thread, result.message);
      if (id === serial.current && origin.current === projectSessionKey())
        setLatest({
          reference,
          thread: detail.thread,
          message: result.message,
          field: source.field,
        });
    } catch (cause) {
      if (id === serial.current && origin.current === projectSessionKey())
        setError(cause);
    } finally {
      if (id === serial.current && origin.current === projectSessionKey())
        setBusy(false);
    }
  }
  return {
    value,
    current,
    latest,
    busy,
    error,
    load,
    adopt: () => {
      if (latest) {
        serial.current++;
        setBusy(false);
        change(latest);
        setLatest(null);
        setError(undefined);
      }
    },
    remove: () => {
      serial.current++;
      setBusy(false);
      change(undefined);
      setLatest(null);
      setError(undefined);
    },
  };
}
export function DiscussionAdoptionSource({
  projectId,
  source,
  disabled = false,
}: {
  projectId: string;
  source: ReturnType<typeof useDiscussionAdoptionSource>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  if (!source.value) return null;
  return (
    <div className="delivery-discussion">
      <DiscussionSourceCard adoption={source.value} />
      <div className="discussion-actions">
        <Button
          disabled={disabled}
          loading={source.busy}
          onClick={() => void source.load(projectId)}
        >
          {t("deliveryDiscussion.loadLatest")}
        </Button>
        <Button disabled={disabled} onClick={source.remove}>
          {t("deliveryDiscussion.dropSource")}
        </Button>
        <Button
          disabled={disabled}
          href={discussionThreadHref(
            projectId,
            source.value.reference.thread_id,
            source.value.reference.message_id,
            source.value.reference.message_revision,
          )}
        >
          {t("deliveryDiscussion.returnDiscussion")}
        </Button>
      </div>
      {Boolean(source.error) && (
        <>
          <DiscussionProblem error={source.error} />
          <Alert type="warning" title={t("deliveryDiscussion.sourceChanged")} />
        </>
      )}
      {source.latest && (
        <>
          <DiscussionSourceCard adoption={source.latest} />
          <Button disabled={disabled} onClick={source.adopt}>
            {t("deliveryDiscussion.adoptLatest")}
          </Button>
        </>
      )}
    </div>
  );
}
export function applyDiscussionAdoption<
  T extends { description: string; acceptance_criteria: string[] },
>(current: T, source?: DiscussionAdoption): T {
  if (!source) return current;
  const body = source.message.body || "";
  return {
    ...current,
    ...(source.field === "description"
      ? {
          description: [current.description, body].filter(Boolean).join("\n\n"),
        }
      : { acceptance_criteria: [...current.acceptance_criteria, body] }),
  };
}
