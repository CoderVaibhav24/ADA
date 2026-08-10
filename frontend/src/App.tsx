import * as reactRouterDom from "react-router-dom";
import { Navigate, Route, Routes } from "react-router-dom";
import { getSuperTokensRoutesForReactRouterDom } from "supertokens-auth-react/ui";
import { EmailPasswordPreBuiltUI } from "supertokens-auth-react/recipe/emailpassword/prebuiltui";
import { SessionAuth } from "supertokens-auth-react/recipe/session";
import Dashboard from "./components/Dashboard";

export default function App() {
  return (
    <Routes>
      {getSuperTokensRoutesForReactRouterDom(reactRouterDom, [
        EmailPasswordPreBuiltUI,
      ])}
      <Route
        path="/"
        element={
          <SessionAuth>
            <Dashboard />
          </SessionAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
