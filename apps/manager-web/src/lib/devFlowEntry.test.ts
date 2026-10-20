import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformWithEsbuild } from "vite";
import { describe, expect, it, vi } from "vitest";

describe("the active console development-flow entry", () => {
  it("opens the canonical workbench without querying an implicit project", async () => {
    const consoleHtml = readFileSync(new URL("../../public/console.html", import.meta.url), "utf8");
    const entry = [...consoleHtml.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
      .map((match) => match[1])
      .find((src) => src.split("?")[0] === "pages/dev_flow.js");
    expect(entry).toBeDefined();
    const source = readFileSync(new URL("../../public/" + entry!.split("?")[0], import.meta.url), "utf8");
    const { code } = await transformWithEsbuild(source, "dev_flow.jsx", {
      loader: "jsx",
      jsx: "transform",
      jsxFactory: "React.createElement",
      jsxFragment: "React.Fragment",
    });
    const replace = vi.fn();
    const useFetch = vi.fn(() => ({ loading: true, data: undefined }));
    const effects: Array<() => void> = [];
    const context = {
      API: "/api/v1",
      window: { location: { replace }, t: (key: string) => key },
      React: {
        useMemo: (callback: () => unknown) => callback(),
        useState: (value: unknown) => [value, vi.fn()],
        useEffect: (callback: () => void) => effects.push(callback),
        createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
      },
      useFetch,
      PageSkeleton: () => null,
    };
    runInNewContext(code + "\nDevFlowHub();", context);
    effects.forEach((effect) => effect());
    expect(useFetch).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("/#/dev-flow?view=overview");
  });
});
