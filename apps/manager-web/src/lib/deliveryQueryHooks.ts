import { useQueries } from "@tanstack/react-query";
import type { DeliveryMember } from "./delivery";
import { fetchDeliveryReferences } from "./deliveryQuery";
import { getSessionRevision } from "./authStorage";

// Resolve identities only for records currently being displayed; each request is bounded.
export function useDeliveryMemberReferences(
  projectId: string,
  sessionId: string,
  ids: string[],
  queryGeneration?: number | null,
) {
  const unique = [...new Set(ids.filter(Boolean))].sort();
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += 100)
    chunks.push(unique.slice(index, index + 100));
  const queries = useQueries({
    queries: chunks.map((selected) => ({
      queryKey: [
        "delivery-member-labels",
        projectId,
        sessionId,
        getSessionRevision(),
        queryGeneration,
        selected,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchDeliveryReferences<DeliveryMember>(
          projectId,
          "member",
          { ids: selected, limit: 100 },
          signal,
          queryGeneration,
        ),
      retry: false,
      gcTime: 0,
    })),
  });
  return {
    members: queries.flatMap(
      (query) => query.data?.items.map((item) => item.data) || [],
    ),
    error: queries.find((query) => query.error)?.error,
  };
}
