import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import DesignSystemPage from "./DesignSystemPage";
import { initTheme } from "@/lib/theme";
// The showcase renders real primitives, so it needs the same i18next singleton.
import "@/i18n";
import "@/styles/icms-theme.css";

initTheme();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

ReactDOM.createRoot(rootEl).render(
  <StrictMode>
    <DesignSystemPage />
  </StrictMode>,
);
