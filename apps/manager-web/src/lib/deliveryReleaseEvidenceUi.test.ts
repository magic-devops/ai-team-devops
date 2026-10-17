import { isValidElement, type ReactNode } from "react";
import { Button, Input } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeliveryReleaseEvidenceEditor,
  readEnvelopeFile,
} from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryReleaseEvidenceEditor";
import {
  fetchDeliveryQuality,
  fetchDeliveryReleases,
  submitReleaseCommand,
} from "./deliveryRelease";
import { releaseIndex, releaseQuality } from "./deliveryReleaseFixtures";
const hooks = vi.hoisted(() => ({
  state: [] as unknown[],
  next: 0,
  scope: "original",
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => {
    const i = hooks.next++;
    if (!(i in hooks.state))
      hooks.state[i] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.state[i],
      (change: unknown) => {
        hooks.state[i] =
          typeof change === "function" ? change(hooks.state[i]) : change;
      },
    ];
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("./projectPortfolio", async () => ({
  ...(await vi.importActual<typeof import("./projectPortfolio")>(
    "./projectPortfolio",
  )),
  projectSessionKey: () => hooks.scope,
}));
vi.mock("./deliveryRelease", async () => ({
  ...(await vi.importActual<typeof import("./deliveryRelease")>(
    "./deliveryRelease",
  )),
  fetchDeliveryQuality: vi.fn(),
  fetchDeliveryReleases: vi.fn(),
  submitReleaseCommand: vi.fn(),
}));
function find(
  node: ReactNode,
  type: unknown,
  key: string,
): Record<string, any> | undefined {
  if (Array.isArray(node))
    return node.map((n) => find(n, type, key)).find(Boolean);
  if (!isValidElement<Record<string, any>>(node)) return undefined;
  if (
    node.type === type &&
    (node.props.children === `deliveryRelease.${key}` ||
      node.props["aria-label"] === `deliveryRelease.${key}`)
  )
    return node.props;
  return (
    find(node.props.children, type, key) || find(node.props.footer, type, key)
  );
}
const close = vi.fn();
const render = (mode: "policy" | "ci" = "ci") => {
  hooks.next = 0;
  return DeliveryReleaseEvidenceEditor({
    projectId: "P",
    initial: releaseIndex,
    quality: releaseQuality,
    mode,
    onClose: close,
    onSaved: vi.fn(),
  });
};
const button = (key: string, mode: "policy" | "ci" = "ci") =>
  find(render(mode), Button, key)!;
beforeEach(() => {
  hooks.state = [];
  hooks.next = 0;
  hooks.scope = "original";
  close.mockClear();
  vi.mocked(submitReleaseCommand)
    .mockReset()
    .mockResolvedValue({} as never);
  vi.mocked(fetchDeliveryReleases)
    .mockReset()
    .mockResolvedValue({ ...releaseIndex, version: 9 });
  vi.mocked(fetchDeliveryQuality).mockReset().mockResolvedValue(releaseQuality);
});
describe("signed CI input keeps original text and explicit trust", () => {
  it("reads file text without parsing away duplicate JSON keys", async () => {
    const raw = '{"payload":"first","payload":"second"}';
    expect(
      await readEnvelopeFile({ size: raw.length, text: async () => raw }),
    ).toBe(raw);
    await expect(
      readEnvelopeFile({ size: 131073, text: async () => "unread" }),
    ).rejects.toThrow();
    find(render(), Input.TextArea, "envelope")!.onChange({
      target: { value: raw },
    });
    await button("import").onClick();
    expect(vi.mocked(submitReleaseCommand).mock.calls[0]).toEqual([
      "P",
      "release.ci.import",
      { envelope: raw, requirement_ids: ["R-1"], task_ids: ["T-one"] },
      expect.objectContaining({ version: 7 }),
    ]);
  });
  it("retains envelope and retry identity after a failed import and requires explicit adoption after conflict", async () => {
    find(render(), Input.TextArea, "envelope")!.onChange({
      target: { value: '{"original":true}' },
    });
    vi.mocked(submitReleaseCommand).mockRejectedValueOnce(
      new Error("HTTP 409"),
    );
    await button("import").onClick();
    expect(close).not.toHaveBeenCalled();
    expect(button("import").disabled).toBe(true);
    await button("readLatest").onClick();
    expect(submitReleaseCommand).toHaveBeenCalledOnce();
    expect(find(render(), Input.TextArea, "envelope")!.value).toBe(
      '{"original":true}',
    );
    button("adopt").onClick();
    await button("import").onClick();
    expect(vi.mocked(submitReleaseCommand).mock.calls[1][3].version).toBe(9);
  });
  it("never submits a PEM private key as a public trust key", async () => {
    find(render("policy"), Input.TextArea, "publicKeys")!.onChange({
      target: { value: "-----BEGIN PRIVATE KEY-----\nsecret" },
    });
    await button("save", "policy").onClick();
    expect(submitReleaseCommand).not.toHaveBeenCalled();
  });
});
