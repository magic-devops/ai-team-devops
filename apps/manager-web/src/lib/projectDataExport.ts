import { getProjectId, getSessionRevision } from "./authStorage";
import { bindSessionDownload } from "./http";
import { projectSessionKey } from "./projectPortfolio";

const scopeChanged = "账号或项目已切换，请在当前工作区重新操作";

function isAnalyticsExportPath(path: string) {
  return path === "/api/v1/data-exchange/export"
    || path.startsWith("/api/v1/data-exchange/export?")
    || path === "/api/v1/analytics/export.csv"
    || /^\/api\/v1\/analytics\/reports\/[^/?#]+\.md$/.test(path);
}

/** Bind when rendering the controls, so an old callback cannot download a new project's data. */
export function bindProjectDataExport(expected: { projectId: string; revision: string }) {
  const origin = projectSessionKey();
  const download = bindSessionDownload(expected);
  const assertOrigin = () => {
    if (!expected.projectId || !expected.revision
      || getProjectId() !== expected.projectId
      || getSessionRevision() !== expected.revision
      || projectSessionKey() !== origin) {
      throw new Error(scopeChanged);
    }
  };

  return async (path: string, filename: string): Promise<void> => {
    assertOrigin();
    if (!isAnalyticsExportPath(path)) throw new Error("下载地址无效，请刷新当前工作区后重试");
    const blob = await download(path);
    assertOrigin();

    let objectUrl: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      assertOrigin();
      objectUrl = URL.createObjectURL(blob);
      assertOrigin();
      anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename.replace(/[\u0000-\u001f<>:"\/\\|?*]/g, "_");
      document.body.appendChild(anchor);
      assertOrigin();
      anchor.click();
    } finally {
      try {
        anchor?.remove();
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    }
  };
}
