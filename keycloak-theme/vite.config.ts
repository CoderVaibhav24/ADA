import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { keycloakify } from "keycloakify/vite-plugin";

// A project of its own, deliberately NOT part of frontend/.
//
// The keycloakify plugin rewrites the build to emit a Keycloak theme rather
// than a single-page app, and the console's build is working. Keeping them
// apart also matches how they are served: this is rendered by Keycloak, on
// Keycloak's origin, from a jar; the console is static files behind nginx.
export default defineConfig({
  plugins: [
    react(),
    keycloakify({
      accountThemeImplementation: "none",
      themeName: "ada",
      // The realm sets loginTheme to this name, and Keycloak resolves it from
      // the jar dropped into /opt/keycloak/providers.
      keycloakVersionDefaultAssets: "26.0.7",
    }),
  ],
});
