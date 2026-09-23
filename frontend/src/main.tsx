import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import ErrorBoundary from "./routes/ErrorBoundary";
// Side-effect import: initialises i18next and sets <html lang> before first paint.
import "./i18n";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/icms-theme.css";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

/**
 * The query cache for the ICMS registers.
 *
 * Defaults chosen against a government LAN and a shared desk machine:
 *
 *   - `refetchOnWindowFocus: false`. An officer alt-tabs to a PDF and back
 *     constantly; refetching every time would repaginate the register under
 *     them. The registers refetch when their query changes, which is the only
 *     moment the rows can have become wrong for the officer's own actions.
 *   - `staleTime: 30s`. Long enough that going into a case and back is free,
 *     short enough that a colleague's assignment shows up on the next move.
 *   - `retry: 1` at the root; the ICMS hooks narrow this further so a 4xx —
 *     a verdict, not a blip — is never retried at all.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 30_000, retry: 1 },
  },
});

ReactDOM.createRoot(rootEl).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </ErrorBoundary>,
);
