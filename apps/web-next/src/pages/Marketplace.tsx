import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "../components/Card";
import { api } from "../lib/api";

export function Marketplace() {
  const [q, setQ] = useState("");
  const list = useQuery({
    queryKey: ["mp", q],
    queryFn: () => api.marketplaceList(q),
  });
  return (
    <Card
      title="Marketplace"
      actions={
        <input
          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:bg-zinc-800 dark:border-zinc-700"
          placeholder="search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(list.data?.items ?? []).map((p: any) => (
          <div
            key={p.name}
            className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <div className="font-semibold">
              {p.name} <span className="ml-1 text-xs text-zinc-500">v{p.version}</span>
            </div>
            <div className="mt-1 text-xs text-zinc-500">{p.type}</div>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
              {p.description}
            </p>
            <div className="mt-2 text-xs text-zinc-500">
              ⭐ {p.rating?.avg ?? 0} · {p.rating?.count ?? 0}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
