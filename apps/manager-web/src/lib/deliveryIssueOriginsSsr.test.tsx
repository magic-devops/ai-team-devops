import { renderToStaticMarkup } from "react-dom/server";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { IssueOriginDirectory } from "../../subapps/ai-rd-center/src/pages/delivery/DeliveryIssueOrigins";
import { issueOriginFixture } from "./deliveryIssueFixtures";
import { issueTranslations } from "../i18n/delivery-issue";
vi.mock("./projectPortfolio", () => ({ projectSessionKey: () => "original" }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      project_id: "P",
      issue_id: "ISS-one",
      issue_available: true,
      as_of: "2026-10-19T00:00:00Z",
      total: 3,
      limit: 20,
      next_cursor: null,
      items: [
        { ...issueOriginFixture, id: "create", operation: "create" },
        { ...issueOriginFixture, id: "update", operation: "update" },
        {
          ...issueOriginFixture,
          id: "delete",
          operation: "delete",
          available: false,
          unavailable_reason: "event_origin_original_missing",
        },
      ],
    },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
describe("origin directory language and semantic rendering", () => {
  for (const [locale, labels] of [
    [
      "en-US",
      [
        "Created problem",
        "Updated problem",
        "Deleted problem",
        "Processing does not mean acceptance",
        "Actual producer",
      ],
    ],
    [
      "zh-CN",
      [
        "创建问题",
        "更新问题",
        "删除问题",
        "已处理不等于已验收",
        "Actual producer",
      ],
    ],
    [
      "ja-JP",
      [
        "問題を作成",
        "問題を更新",
        "問題を削除",
        "処理済みでも検収",
        "Actual producer",
      ],
    ],
  ] as const)
    it(`renders actual operation and safe source text with keyboard controls in ${locale}`, async () => {
      const language = i18next.createInstance();
      await language.init({
        lng: locale,
        resources: {
          [locale]: {
            translation: { deliveryIssue: issueTranslations[locale] },
          },
        },
        interpolation: { escapeValue: false },
      });
      const html = renderToStaticMarkup(
        <I18nextProvider i18n={language}>
          <IssueOriginDirectory
            projectId="P"
            issueId="ISS-one"
            background="#/dev-flow?view=issues&project_id=P&issue=ISS-one"
          />
        </I18nextProvider>,
      );
      for (const label of labels) expect(html).toContain(label);
      expect(html).toContain("receipt-one");
      expect(html).toContain("<time");
      expect(html).toContain("<nav");
      expect(html).toContain("https://untrusted.example/run/guess");
      expect(html).not.toContain('href="https://untrusted.example');
      expect(html).not.toContain("deliveryIssue.");
      expect(html).not.toContain("event_json");
    });
});
