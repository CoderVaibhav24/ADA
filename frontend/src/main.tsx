import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

// No SDK init here any more. SuperTokens needed a synchronous SuperTokens.init
// before the first render; the OIDC UserManager is built lazily inside
// auth/oidc.ts, because its configuration is fetched from /api/auth/config and
// an await cannot happen before createRoot.

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

// Note: StrictMode is intentionally omitted — the MapLibre + terra-draw
// instances are imperative singletons and dev double-mounting them adds
// noise without value for this POC.
ReactDOM.createRoot(rootEl).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
