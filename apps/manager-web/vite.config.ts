import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tslibPath = path.dirname(require.resolve("tslib/package.json"));

// 开发期：把 /api 和 /ws 反代到本地 Manager API（与 start-manager.sh 默认端口一致）
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      tslib: tslibPath,
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    open: "/",
    proxy: {
      "/api": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8765", ws: true },
      "/metrics": { target: "http://127.0.0.1:8765", changeOrigin: true },
      // OpenAPI / ReDoc 与静态台同源开发时走此代理（否则 5173 根路径无 /redoc）
      "/docs": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/redoc": { target: "http://127.0.0.1:8765", changeOrigin: true },
      "/openapi.json": { target: "http://127.0.0.1:8765", changeOrigin: true },
    },
  },
  build: {
    sourcemap: true,
    outDir: "dist",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        mainAdmin: path.resolve(__dirname, "subapps/main-admin/index.html"),
        aiFoundation: path.resolve(__dirname, "subapps/ai-foundation/index.html"),
        aiRdCenter: path.resolve(__dirname, "subapps/ai-rd-center/index.html"),
        aiDataCenter: path.resolve(__dirname, "subapps/ai-data-center/index.html"),
        aiOpsCenter: path.resolve(__dirname, "subapps/ai-ops-center/index.html"),
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          const normalized = id.replaceAll("\\", "/");
          if (/node_modules\/(react|react-dom|scheduler)\//.test(normalized)) return "react-vendor";
          if (normalized.includes("@tanstack")) return "query-vendor";
          if (normalized.includes("@ant-design/x")) return "antdx-vendor";
          if (/node_modules\/(@antv|@ant-design\/(plots|charts|graphs))\//.test(normalized)) return "visualization-vendor";
          if (normalized.includes("antd") || normalized.includes("@ant-design") || normalized.includes("@rc-component") || normalized.includes("rc-")) return "antd-vendor";
          if (normalized.includes("react-markdown") || normalized.includes("remark-")) return "markdown-vendor";
          if (normalized.includes("@radix-ui")) return "radix-vendor";
          if (normalized.includes("lucide-react")) return "icon-vendor";
          if (normalized.includes("i18next")) return "i18n-vendor";
          if (/node_modules\/(lodash|lodash-es|throttle-debounce)\//.test(normalized)) return "utility-vendor";
          if (normalized.includes("/node_modules/zrender/")) return "zrender-vendor";
          if (normalized.includes("echarts")) return "echarts-vendor";
          return "vendor";
        },
      },
    },
  },
});
