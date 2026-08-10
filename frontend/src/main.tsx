import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import SuperTokens from "supertokens-auth-react";
import App from "./App";
import { superTokensConfig } from "./config/supertokens";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

SuperTokens.init(superTokensConfig);

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
