import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@dipstick/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      // websocket-staleness-signal design.md Decision D9 (Engineer design
      // review finding 8): Vite's proxy requires an explicit ws: true per
      // entry to upgrade and forward WebSocket connections. Without this,
      // npm run dev cannot reach the backend's /ws/sessions/:sessionId route.
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
