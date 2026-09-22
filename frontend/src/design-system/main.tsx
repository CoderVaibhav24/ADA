import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import DesignSystemPage from "./DesignSystemPage";
import { initTheme } from "@/lib/theme";
import "@/styles/icms-theme.css";

initTheme();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

ReactDOM.createRoot(rootEl).render(
  <StrictMode>
    <DesignSystemPage />
  </StrictMode>,
);
