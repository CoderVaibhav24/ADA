import { Navigate, Route, Routes } from "react-router-dom";
import AuthGate, { Callback, SignedOut } from "./auth/AuthGate";
import { CALLBACK_PATH, SIGNED_OUT_PATH } from "./auth/oidc";
import Dashboard from "./components/Dashboard";

/**
 * The two auth routes are siblings of the gated one, not children of it: the
 * callback is what establishes the session, so it cannot require a session.
 */
export default function App() {
  return (
    <Routes>
      <Route path={CALLBACK_PATH} element={<Callback />} />
      <Route path={SIGNED_OUT_PATH} element={<SignedOut />} />
      <Route
        path="/"
        element={
          <AuthGate>
            <Dashboard />
          </AuthGate>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
