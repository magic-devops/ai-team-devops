import { useQuery } from "@tanstack/react-query";
import { Card } from "../components/Card";
import { api } from "../lib/api";

export function Projects() {
  const q = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  return (
    <Card title="Projects">
      {q.isLoading ? <div>…</div> : null}
      {q.error ? <div className="text-red-600">{(q.error as Error).message}</div> : null}
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {(q.data ?? []).map((p: any) => (
          <li key={p.id ?? p.name} className="py-2">
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-zinc-500">{p.id}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
