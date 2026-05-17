/** 轻量 Markdown → HTML（无额外依赖，覆盖规约/方案/AI 回复常用语法） */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

export function markdownToHtml(md: string): string {
  const lines = escapeHtml(md).split("\n");
  const out: string[] = [];
  let inUl = false;

  const closeUl = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
  };

  for (const line of lines) {
    if (/^### /.test(line)) {
      closeUl();
      out.push(`<h3>${line.slice(4)}</h3>`);
      continue;
    }
    if (/^## /.test(line)) {
      closeUl();
      out.push(`<h2>${line.slice(3)}</h2>`);
      continue;
    }
    if (/^# /.test(line)) {
      closeUl();
      out.push(`<h1>${line.slice(2)}</h1>`);
      continue;
    }
    if (/^- /.test(line)) {
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inlineFormat(line.slice(2))}</li>`);
      continue;
    }
    closeUl();
    if (!line.trim()) {
      out.push("<br />");
      continue;
    }
    out.push(`<p>${inlineFormat(line)}</p>`);
  }
  closeUl();
  return out.join("\n");
}
