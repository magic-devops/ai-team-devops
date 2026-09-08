import { useState } from "react";
import { Alert, Collapse, Input, Table, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { HermesEntity } from "../lib/hermes";

export type CodeEvidence = {
  base_commit: string;
  head_commit: string;
  patch: string;
  files: { path: string; status: string }[];
  untracked: string[];
  truncated: boolean;
  complete: boolean;
  captured_at: string;
  sha256: string;
};

export function CodeEvidencePanel({ run }: { run: HermesEntity }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const evidence = run.data.code_evidence as CodeEvidence | undefined;
  if (run.data.isolation !== "git_worktree") return null;
  return (
    <section aria-label={t("workspace.code.review")} className="space-y-2">
      <Typography.Title level={5}>
        {t("workspace.code.review")}
      </Typography.Title>
      {!evidence ? (
        <Alert type="info" showIcon title={t("workspace.code.pending")} />
      ) : (
        <>
          {(!evidence.complete ||
            evidence.truncated ||
            evidence.untracked.length > 0) && (
            <Alert
              type="warning"
              showIcon
              title={t("workspace.code.incomplete")}
            />
          )}
          <Typography.Text type="secondary">
            {evidence.base_commit.slice(0, 12)} →{" "}
            {evidence.head_commit.slice(0, 12)}
          </Typography.Text>
          <Input.Search
            allowClear
            aria-label={t("workspace.code.search")}
            placeholder={t("workspace.code.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Table
            size="small"
            rowKey="path"
            pagination={{ pageSize: 10, size: "small" }}
            dataSource={[
              ...evidence.files,
              ...evidence.untracked.map((path) => ({ path, status: "?" })),
            ].filter((file) =>
              file.path.toLowerCase().includes(search.toLowerCase()),
            )}
            columns={[
              {
                title: t("workspace.code.file"),
                dataIndex: "path",
                render: (path: string) => (
                  <Typography.Text style={{ wordBreak: "break-all" }}>
                    {path}
                  </Typography.Text>
                ),
              },
              {
                title: t("workspace.columns.status"),
                dataIndex: "status",
                width: 72,
              },
            ]}
          />
          <Collapse
            items={[
              {
                key: "diff",
                label: t("workspace.code.diff"),
                children: (
                  <pre
                    tabIndex={0}
                    aria-label={t("workspace.code.diff")}
                    className="max-h-96 overflow-auto border border-[var(--border)] p-2 text-xs"
                  >
                    {evidence.patch || t("workspace.code.noChanges")}
                  </pre>
                ),
              },
              {
                key: "snapshot",
                label: t("workspace.code.snapshot"),
                children: (
                  <Typography.Paragraph
                    copyable
                    style={{ wordBreak: "break-all" }}
                  >
                    {evidence.sha256}
                  </Typography.Paragraph>
                ),
              },
            ]}
          />
        </>
      )}
    </section>
  );
}
