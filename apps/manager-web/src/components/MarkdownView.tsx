import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownView({
  content,
  className = "",
  minHeight,
}: {
  content: string;
  className?: string;
  minHeight?: string;
}) {
  if (!content?.trim()) {
    return <p className="text-sm text-[var(--muted)]">—</p>;
  }

  return (
    <div
      className={`markdown-preview prose prose-sm max-w-none dark:prose-invert ${className}`.trim()}
      style={minHeight ? { minHeight } : undefined}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
