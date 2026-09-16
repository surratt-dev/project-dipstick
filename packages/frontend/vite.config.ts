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
      // Only the backend's actual /auth/* API routes are proxied here, by
      // exact path -- not a blanket "/auth" prefix. /auth/error and
      // /auth/dev-login are frontend-only React Router pages (App.tsx) that
      // happen to share the /auth/ namespace; a prefix match would forward a
      // hard navigation/redirect to those paths into the backend instead of
      // letting Vite fall through to the SPA, and the backend has no such
      // routes (nor should it -- they need the React app, not JSON).
      // The regex is matched against the full url (path + query string), not
      // just the pathname, so it must tolerate a trailing "?...".
      "^/auth/(login|callback|logout|session|dev-login-options)(\\?.*)?$":
        "http://localhost:3000",
      // websocket-staleness-signal design.md Decision D9 (Engineer design
      // review finding 8): Vite's proxy requires an explicit ws: true per
      // entry to upgrade and forward WebSocket connections. Without this,
      // npm run dev cannot reach the backend's /ws/sessions/:sessionId route.
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
