import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { keycloakify } from "keycloakify/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    keycloakify({
      accountThemeImplementation: "none",
      themeName: "ada",
      keycloakVersionDefaultAssets: "26.0.7",
    }),
  ],
});
