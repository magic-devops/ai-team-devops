import { Alert, Button } from "antd";
import { useTranslation } from "react-i18next";
import { eventProblem } from "@/lib/eventReceipts";
export function ReflectionProblem({ error, onRetry, onFirst }: { error: unknown; onRetry?: () => void; onFirst?: () => void }) {
  const { t } = useTranslation();
  const problem = eventProblem(error);
  const cursor = problem.cursor || /reflection_cursor_(?:invalid|stale)/.test(problem.message);
  return <Alert role="alert" type="error" showIcon title={t("reflections." + (problem.forbidden ? "forbidden" : problem.missing ? "missing" : cursor ? "stale" : "readFailed"))} description={t("reflections.selectionRetained")} action={<div className="reflection-actions">{cursor && onFirst && <Button onClick={onFirst}>{t("reflections.first")}</Button>}{onRetry && <Button onClick={onRetry}>{t("reflections.refresh")}</Button>}</div>} />;
}
