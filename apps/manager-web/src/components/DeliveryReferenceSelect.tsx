import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Alert, Button, Select } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getProjectId, getSessionRevision, getToken } from "@/lib/authStorage";
import {
  fetchDeliveryReferences,
  type DeliveryReferenceKind,
} from "@/lib/deliveryQuery";

export function DeliveryReferenceSelect({
  kind,
  value,
  onChange,
  multiple,
  disabled,
  label,
  options: initialOptions = [],
  filter,
  queryGeneration,
}: {
  kind: DeliveryReferenceKind;
  value?: string | string[];
  onChange?: (value: any) => void;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  options?: { label: string; value: string; disabled?: boolean }[];
  filter?: (data: Record<string, unknown>) => boolean;
  queryGeneration?: number | null;
}) {
  const { t } = useTranslation();
  const projectId = getProjectId() || "",
    session = getSessionRevision();
  const [q, setQ] = useState("");
  const ids = (Array.isArray(value) ? value : value ? [value] : []).filter(
    (id) => !id.startsWith("draft-") && id !== "__clear__",
  );
  const enabled = Boolean(projectId && getToken());
  const query = useInfiniteQuery({
    queryKey: [
      "delivery-reference-options",
      projectId,
      session,
      kind,
      queryGeneration,
      q,
    ],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      fetchDeliveryReferences(
        projectId,
        kind,
        { q, cursor: pageParam, limit: 50 },
        signal,
        queryGeneration,
      ),
    getNextPageParam: (page) => page.next_cursor || undefined,
    enabled,
    retry: false,
    gcTime: 0,
  });
  const selected = useQuery({
    queryKey: [
      "delivery-reference-selected",
      projectId,
      session,
      kind,
      queryGeneration,
      ids,
    ],
    queryFn: ({ signal }) =>
      fetchDeliveryReferences(
        projectId,
        kind,
        { ids, limit: 100 },
        signal,
        queryGeneration,
      ),
    enabled: enabled && ids.length > 0,
    retry: false,
    gcTime: 0,
  });
  const options = new Map(
    initialOptions.map((option) => [option.value, option]),
  );
  for (const item of [
    ...(query.data?.pages.flatMap((page) => page.items) || []),
    ...(selected.data?.items || []),
  ])
    options.set(item.id, {
      label: item.label,
      value: item.id,
      disabled: filter ? !filter(item.data) : false,
    });
  for (const id of ids)
    if (!options.has(id))
      options.set(id, {
        value: id,
        label: `${id} · ${t("deliveryQuery.unavailable")}`,
        disabled: true,
      });
  return (
    <Select
      className="delivery-reference-select"
      aria-label={label}
      mode={multiple ? "multiple" : undefined}
      value={value}
      onChange={onChange}
      disabled={disabled}
      showSearch
      filterOption={false}
      onSearch={setQ}
      options={[...options.values()]}
      loading={query.isFetching || selected.isFetching}
      popupRender={(menu) => (
        <>
          {menu}
          {query.hasNextPage && (
            <Button
              type="text"
              block
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t("deliveryQuery.more")}
            </Button>
          )}
          {query.error && (
            <Alert
              type="error"
              title={t("deliveryQuery.readFailed")}
              action={
                <Button onClick={() => void query.refetch()}>
                  {t("deliveryQuery.retry")}
                </Button>
              }
            />
          )}
        </>
      )}
    />
  );
}
