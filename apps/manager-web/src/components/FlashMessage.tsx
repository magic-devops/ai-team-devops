type Kind = "ok" | "err";

const styles: Record<Kind, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
  err: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-100",
};

export function FlashMessage({
  kind,
  message,
  onDismiss,
}: {
  kind: Kind;
  message: string;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${styles[kind]}`}
    >
      <span className="min-w-0 flex-1">{message}</span>
      {onDismiss ? (
        <button
          type="button"
          className="shrink-0 rounded px-1 opacity-70 hover:opacity-100"
          aria-label="dismiss"
          onClick={onDismiss}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
