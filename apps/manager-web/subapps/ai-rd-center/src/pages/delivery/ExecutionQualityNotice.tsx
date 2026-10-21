import { Alert, Space, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { ExecutionQuality } from "@/lib/executionQuality";
import { executionQualityCopy } from "@/i18n/execution-quality";

export function ExecutionQualityNotice({ quality }: { quality?: ExecutionQuality }) {
  const { i18n } = useTranslation(), copy = executionQualityCopy(i18n?.language);
  const status = quality?.status || "invalid";
  return <Alert showIcon role="status" type={status === "passed" ? "success" : status === "pending" ? "info" : "warning"}
    title={copy.title} description={<>
      <p>{copy[status]}</p>
      {["not_configured", "failed", "invalid"].includes(status) && <p>{copy.next}</p>}
      {status === "passed" && quality && quality.reused_node_ids.length > 0 && <Space direction="vertical" size="small">
        <span>{copy.reused}</span>
        <Space wrap>{quality.tests.filter((test) => test.reused).map((test) => <Tag key={test.node_id}>
          {test.node_id} · {copy.attempt} {test.result_attempt}
        </Tag>)}</Space>
      </Space>}
    </>} />;
}
