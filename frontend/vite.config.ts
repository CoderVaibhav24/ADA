import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: all same-origin /api/* calls are forwarded to the FastAPI
// backend so SuperTokens session cookies flow without CORS friction.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
