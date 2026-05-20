import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { XProvider } from "@ant-design/x";
import { App as AntdApp, ConfigProvider } from "antd";
import "antd/dist/reset.css";
import "../../src/i18n";
import "../../src/index.css";
import { MicroAppRuntime } from "./MicroAppRuntime";
import type { MicroAppId } from "../../src/microApps";

function getOrCreateRoot() {
  const existing = document.getElementById("root");
  if (existing) return existing;
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  return root;
}

export function bootstrapMicroApp(appId: MicroAppId) {
  document.documentElement.dataset.shell = "micro-app";
  document.body.classList.add("sop-micro-app-standalone");

  const qc = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
    },
  });

  ReactDOM.createRoot(getOrCreateRoot()).render(
    <QueryClientProvider client={qc}>
      <ConfigProvider
        theme={{
          token: {
            borderRadius: 8,
            colorPrimary: "#0f766e",
            colorInfo: "#2563eb",
            colorText: "#172033",
            fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          },
          components: {
            Button: { controlHeight: 36 },
            Input: { controlHeight: 36 },
            Select: { controlHeight: 36 },
            Table: { cellPaddingBlock: 10, headerBg: "#f7f9fc", headerColor: "#526176" },
          },
        }}
      >
        <XProvider>
          <AntdApp message={{ maxCount: 3 }}>
            <MicroAppRuntime appId={appId} />
          </AntdApp>
        </XProvider>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}
