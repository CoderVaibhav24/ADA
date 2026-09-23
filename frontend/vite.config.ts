import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function infraEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let text: string;
  try {
    text = readFileSync(resolve(__dirname, "../infra/.env"), "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = infraEnv();
const port = (name: string, fallback: number): number =>
  Number(process.env[name] ?? env[name] ?? fallback);

const showcase = process.env.ICMS_DESIGN_SYSTEM === "1";

const NESTED_PROJECT = "**/keycloak-theme/**";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    entries: ["index.html", "design-system.html"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
    // Belt-and-braces. react/react-dom are pinned to one version by the root
    // package.json overrides, so only one copy is installed; two copies load two
    // hook dispatchers and every render dies on "Cannot read properties of null
    // (reading 'useEffect')". Keep this in case a workspace re-pins React.
    dedupe: ["react", "react-dom"],
  },
  build: showcase
    ? {
        rollupOptions: {
          input: {
            main: resolve(__dirname, "index.html"),
            designSystem: resolve(__dirname, "design-system.html"),
          },
        },
      }
    : undefined,
  server: {
    watch: { ignored: [NESTED_PROJECT] },
    proxy: {
      "/api": {
        target: `http://localhost:${port("BACKEND_PORT", 8010)}`,
        changeOrigin: true,
      },
      "/idp": {
        target: `http://localhost:${port("KC_HTTP_HOST_PORT", 8091)}`,
        changeOrigin: true,
      },
      "/auth-api": {
        target: `http://localhost:${port("ADA_AUTH_PORT", 8012)}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/auth-api/, ""),
      },
    },
  },
});
