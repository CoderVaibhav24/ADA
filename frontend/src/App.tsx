/**
 * The route tree.
 *
 * Shape, top to bottom:
 *
 *   public        /login, /auth/callback — reachable with no session, because
 *                 they are how a session is obtained. /auth/signed-out is kept
 *                 only as a redirect for sign-outs already in flight and for
 *                 bookmarks; the login screen is where a sign-out lands now.
 *
 *   protected     everything else, behind <RequireAuth> and inside
 *                 <ProtectedLayout>. RequireAuth is a LAYOUT route, so the
 *                 session is checked once for the whole subtree rather than
 *                 per screen, and adding a screen cannot accidentally leave it
 *                 unguarded. ProtectedLayout is where the shared shell — the
 *                 icon rail, the top bar, the account menu — is mounted, so a
 *                 route added here is navigable and chromed for free.
 *
 *   catch-all     a real 404 screen. The previous tree silently redirected
 *                 every unknown path to "/", which made a broken link
 *                 indistinguishable from a working one.
 *
 * The screens marked TODO(icms) are the remaining Figma screens. Their routes
 * exist now so that navigation, guards and deep links are settled once instead
 * of being retrofitted onto each screen as it is built; each renders a
 * <Placeholder> that says so. Five of them ARE in the rail (see routes/nav.ts)
 * — a section that cannot be reached cannot be tested, and a placeholder that
 * names itself is a better answer than a dead end.
 *
 * The words belong to routes/labels.en.ts, not to this file: a translator must
 * not have to read a route tree, and a route tree reads better as a tree than
 * as prose.
 */

import { Navigate, Route, Routes } from "react-router-dom";

import Dashboard from "./components/Dashboard";
import ComplaintsRegister from "./features/complaints/ComplaintsRegister";
import AuthCallback from "./routes/AuthCallback";
import { placeholderScreensEn } from "./routes/labels.en";
import Login from "./routes/Login";
import NotFound from "./routes/NotFound";
import Placeholder from "./routes/Placeholder";
import ProtectedLayout from "./routes/ProtectedLayout";
import RequireAuth from "./routes/RequireAuth";
import {
  CALLBACK_PATH,
  HOME_PATH,
  LEGACY_SIGNED_OUT_PATH,
  LOGIN_PATH,
  ROUTES,
} from "./routes/paths";

export default function App() {
  const screens = placeholderScreensEn;

  return (
    <Routes>
      <Route path={LOGIN_PATH} element={<Login />} />
      <Route path={CALLBACK_PATH} element={<AuthCallback />} />
      <Route
        path={LEGACY_SIGNED_OUT_PATH}
        element={<Navigate to={`${LOGIN_PATH}?signedout=1`} replace />}
      />
      <Route element={<RequireAuth />}>
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Navigate to={HOME_PATH} replace />} />
          <Route path={ROUTES.changeDetection} element={<Dashboard />} />
          <Route
            path={ROUTES.dashboard}
            element={<Placeholder {...screens.dashboard} icon="nav.dashboard" />}
          />
          <Route path={ROUTES.complaints} element={<ComplaintsRegister />} />
          <Route
            path={ROUTES.complaintNew}
            element={
              <Placeholder {...screens.complaintNew} icon="nav.createComplaint" />
            }
          />
          <Route
            path={ROUTES.complaint()}
            element={<Placeholder {...screens.complaint} icon="nav.complaints" />}
          />
          <Route
            path={ROUTES.inspections}
            element={<Placeholder {...screens.inspections} icon="nav.inspection" />}
          />
          <Route
            path={ROUTES.inspection()}
            element={<Placeholder {...screens.inspection} icon="nav.inspection" />}
          />
          <Route
            path={ROUTES.inspectionFindings()}
            element={
              <Placeholder
                {...screens.inspectionFindings}
                icon="inspection.findings"
              />
            }
          />
          <Route
            path={ROUTES.notices}
            element={<Placeholder {...screens.notices} icon="nav.notice" />}
          />
          <Route
            path={ROUTES.noticeNew}
            element={<Placeholder {...screens.noticeNew} icon="notice.draft" />}
          />
          <Route
            path={ROUTES.notice()}
            element={<Placeholder {...screens.notice} icon="nav.notice" />}
          />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
