/**
 * The theme's browser entry.
 *
 * Keycloak serves a small FreeMarker shell that sets `window.kcContext` and
 * loads this bundle; everything visible is rendered here. The branch matters:
 * without a kcContext this file is being opened outside Keycloak, and saying
 * so beats a blank page.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { KcPage } from "./kc.gen";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.kcContext ? (
      <KcPage kcContext={window.kcContext} />
    ) : (
      <p style={{ fontFamily: "system-ui", padding: 24 }}>
        ADA Keycloak theme — no kcContext. Open this through Keycloak, or run{" "}
        <code>npx keycloakify start-keycloak</code>.
      </p>
    )}
  </StrictMode>,
);
