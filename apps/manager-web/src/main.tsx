import ReactDOM from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { XProvider } from "@ant-design/x";
import "antd/dist/reset.css";
import "./i18n";
import { App } from "./App";
import "./index.css";
import { applyHashNormalization } from "./lib/routeAliases";
import { maybeRedirectToPrimaryConsole } from "./lib/shellEntry";
import { initTheme } from "./lib/theme";
import { SopThemeProvider } from "./lib/themeProvider";
import { SessionQueryProvider } from "./lib/SessionQueryProvider";

maybeRedirectToPrimaryConsole();
applyHashNormalization();
initTheme();

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <SessionQueryProvider client={qc}>
    <SopThemeProvider>
      <XProvider>
        <App />
      </XProvider>
    </SopThemeProvider>
  </SessionQueryProvider>,
);
