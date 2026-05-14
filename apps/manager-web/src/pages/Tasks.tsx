import { useQuery } from "@tanstack/react-query";
import { Card } from "../components/Card";
import { api } from "../lib/api";

export function Tasks() {
  const q = useQuery({ queryKey: ["tasks"], queryFn: api.tasks });
  return (
    <Card title="Tasks">
      {q.error ? <div className="text-red-600">{(q.error as Error).message}</div> : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="py-1">ID</th>
            <th className="py-1">Title</th>
            <th className="py-1">Status</th>
            <th className="py-1">Assignee</th>
          </tr>
        </thead>
        <tbody>
          {(q.data ?? []).map((t: any) => (
            <tr key={t.id} className="border-t border-zinc-200 dark:border-zinc-800">
              <td className="py-1 font-mono text-xs">{t.id}</td>
              <td className="py-1">{t.title}</td>
              <td className="py-1">{t.status}</td>
              <td className="py-1">{t.assignee ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
