import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: all same-origin /api/* calls are forwarded to ada-api, so the
// dev server and the API share one origin and no CORS preflight is involved.
// Keycloak is NOT proxied — the browser is redirected to it directly, and the
// realm's redirect URIs list this origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      // ada-auth. The published host port is 8012 because 8002 was already
      // taken on this machine; the path is the same one nginx serves in the
      // container build, so the app code does not know the difference.
      // Keycloak, same-origin, exactly as nginx serves it in the container
      // build. No rewrite: KC_HTTP_RELATIVE_PATH is /idp, so Keycloak expects
      // the prefix to survive.
      "/idp": {
        target: "http://localhost:8091",
        changeOrigin: true,
      },
      "/auth-api": {
        target: "http://localhost:8012",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/auth-api/, ""),
      },
    },
  },
});
