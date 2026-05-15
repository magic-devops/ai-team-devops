import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
// 开发期：把 /api 和 /ws 反代到本地 Manager API（与 start-manager.sh 默认端口一致）
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { "@": path.resolve(__dirname, "src") },
    },
    server: {
        port: 5173,
        strictPort: false,
        open: "/console.html",
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
    },
});
