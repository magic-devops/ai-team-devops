import { useQuery } from "@tanstack/react-query";
import { Button, Select } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchDeliveryReferences, fetchIssuePage } from "@/lib/deliveryQuery";
import { projectSessionKey } from "@/lib/projectPortfolio";
import type { DiscussionReferenceSelection } from "@/lib/deliveryDiscussions";
import { DiscussionProblem } from "./DeliveryDiscussionCommon";
export function DiscussionObjectSelect({
  projectId,
  kind,
  value,
  onChange,
  disabled = false,
}: {
  projectId: string;
  kind: DiscussionReferenceSelection["kind"];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState(""),
    [cursor, setCursor] = useState("");
  const query = useQuery({
    queryKey: [
      "discussion-object-options",
      projectId,
      projectSessionKey(),
      kind,
      search,
      cursor,
    ],
    queryFn: async ({ signal }) => {
      if (kind === "issue") {
        const page = await fetchIssuePage(
          projectId,
          { q: search, cursor, limit: 20 },
          signal,
        );
        if (page.project_id !== projectId)
          throw new Error("discussion_scope_changed");
        return {
          items: page.items.map((item) => ({
            value: item.id,
            label: item.title,
          })),
          next: page.next_cursor,
        };
      }
      const page = await fetchDeliveryReferences(
        projectId,
        kind,
        { q: search, cursor, limit: 20 },
        signal,
      );
      if (page.project_id !== projectId)
        throw new Error("discussion_scope_changed");
      return {
        items: page.items.map((item) => ({
          value: item.id,
          label: item.label,
        })),
        next: page.next_cursor,
      };
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const items = query.error ? [] : query.data?.items || [];
  return (
    <>
      <Select
        showSearch
        filterOption={false}
        aria-label={t("deliveryDiscussion.subject")}
        value={value || undefined}
        disabled={disabled}
        loading={query.isFetching}
        options={
          value && !items.some((item) => item.value === value)
            ? [{ value, label: value }, ...items]
            : items
        }
        onSearch={(text) => {
          setSearch(text);
          setCursor("");
        }}
        onChange={onChange}
      />
      {query.error ? (
        <DiscussionProblem
          error={query.error}
          onRetry={() => void query.refetch()}
          onReset={() => setCursor("")}
        />
      ) : (
        <div className="discussion-actions">
          {cursor && (
            <Button disabled={query.isFetching} onClick={() => setCursor("")}>
              {t("deliveryDiscussion.first")}
            </Button>
          )}
          {query.data?.next && (
            <Button
              disabled={query.isFetching}
              onClick={() => setCursor(query.data!.next!)}
            >
              {t("deliveryDiscussion.next")}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
