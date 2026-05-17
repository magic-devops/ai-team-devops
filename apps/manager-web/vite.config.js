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
            output: {
                manualChunks(id) {
                    if (!id.includes("node_modules"))
                        return undefined;
                    const normalized = id.replaceAll("\\", "/");
                    if (/node_modules\/(react|react-dom|scheduler)\//.test(normalized))
                        return "react-vendor";
                    if (id.includes("@tanstack"))
                        return "query-vendor";
                    if (id.includes("@ant-design/x"))
                        return "antdx-vendor";
                    if (id.includes("antd") || id.includes("@ant-design") || id.includes("@rc-component") || id.includes("rc-"))
                        return "antd-vendor";
                    if (id.includes("react-markdown") || id.includes("remark-"))
                        return "markdown-vendor";
                    if (id.includes("@radix-ui"))
                        return "radix-vendor";
                    if (id.includes("lucide-react"))
                        return "icon-vendor";
                    if (id.includes("i18next"))
                        return "i18n-vendor";
                    if (id.includes("echarts"))
                        return "echarts-vendor";
                    if (id.includes("@antv"))
                        return "antv-vendor";
                    return "vendor";
                },
            },
        },
    },
});
