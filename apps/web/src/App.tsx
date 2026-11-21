import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";

import "./App.css";
import "./styles/shell.css";
import "./styles/editor.css";
import "./styles/auth.css";
import "./styles/pages.css";
import "./styles/select.css";
import "./styles/datetime-picker.css";
import "./styles/panels.css";

import AuthGuard from "./components/AuthGuard";
import AppLayout from "./components/AppLayout";
import ErrorBoundary from "./components/ErrorBoundary";
// First-hit routes (sign-in and the public form) stay in the main chunk: a lazy
// chunk would add a network round trip before the page can render.
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import PublicFormPage from "./pages/PublicFormPage";
import { getToken } from "./lib/api";
import { guestRedirectPath } from "./lib/guestRedirect";
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const SharedWithMePage = lazy(() => import("./pages/SharedWithMePage"));
const CreateFormPage = lazy(() => import("./pages/CreateFormPage"));
const FormEditorPage = lazy(() => import("./pages/FormEditorPage"));
const FormSharePage = lazy(() => import("./pages/FormSharePage"));
const FormPreviewPage = lazy(() => import("./pages/FormPreviewPage"));
const ResponseDashboardPage = lazy(() => import("./pages/ResponseDashboardPage"));
const QRDisplayPage = lazy(() => import("./pages/QRDisplayPage"));
const TeamPage = lazy(() => import("./pages/TeamPage"));
const FoldersPage = lazy(() => import("./pages/FoldersPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));
const AdminPanelPage = lazy(() => import("./pages/AdminPanelPage"));
const AcceptInvitePage = lazy(() => import("./pages/AcceptInvitePage"));

// Every page is its own chunk so a route only downloads what it renders.
// (FormReportsPage also pulls in recharts.)
const FormReportsPage = lazy(() => import("./pages/FormReportsPage"));
// Landing is guest-only, so logged-in users never download this chunk.
const LandingPage = lazy(() => import("./pages/LandingPage"));

function LandingLoadFailed() {
  return (
    <div className="app-root app-shell landing-boot landing-failed">
      <p>Could not load the page.</p>
      <button type="button" className="btn btn-accent" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

function LazyFallback() {
  return (
    <main className="page-shell">
      <div className="status-card">
        <div className="skeleton-block" style={{ width: 180, height: 20, margin: "0 auto" }} />
      </div>
    </main>
  );
}

/** Redirects logged-in users away from the landing and auth pages */
function GuestOnly({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  // Auth is a synchronous token check, so there is no loading state and no
  // flash of the guest page before the redirect.
  const target = guestRedirectPath(!!getToken(), location.search);
  if (target) return <Navigate to={target} replace />;
  return <>{children}</>;
}

/** Protected route with nav layout */
function Protected({ children }: { children: (user: { id: string; name: string; email: string }) => React.ReactNode }) {
  return (
    <AuthGuard>
      {(user) => (
        <AppLayout user={user}>
          {children(user)}
        </AppLayout>
      )}
    </AuthGuard>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<LazyFallback />}>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<GuestOnly><ErrorBoundary fallback={<LandingLoadFailed />}><Suspense fallback={<div className="landing-boot" />}><LandingPage /></Suspense></ErrorBoundary></GuestOnly>} />
        <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
        <Route path="/signup" element={<GuestOnly><SignupPage /></GuestOnly>} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        {/* Public form routes */}
        <Route path="/f/:slug" element={<PublicFormPage />} />
        <Route path="/f/:slug/display" element={<QRDisplayPage />} />

        {/* Protected dashboard routes */}
        <Route path="/dashboard" element={<Protected>{() => <DashboardPage />}</Protected>} />
        <Route path="/forms/new" element={<Protected>{() => <CreateFormPage />}</Protected>} />
        <Route path="/forms/:formId/edit" element={<Protected>{() => <FormEditorPage />}</Protected>} />
        <Route path="/forms/:formId/preview" element={<Protected>{() => <FormPreviewPage />}</Protected>} />
        <Route path="/forms/:formId/responses" element={<Protected>{() => <ResponseDashboardPage />}</Protected>} />
        <Route path="/forms/:formId/reports" element={<Protected>{() => <Suspense fallback={<LazyFallback />}><FormReportsPage /></Suspense>}</Protected>} />
        <Route path="/forms/:formId/share" element={<Protected>{() => <FormSharePage />}</Protected>} />
        <Route path="/accept-invite" element={<Protected>{() => <AcceptInvitePage />}</Protected>} />
        <Route path="/folders" element={<Protected>{() => <FoldersPage />}</Protected>} />
        <Route path="/team" element={<Protected>{() => <TeamPage />}</Protected>} />
        <Route path="/notifications" element={<Protected>{() => <NotificationsPage />}</Protected>} />
        <Route path="/settings" element={<Protected>{(user) => <SettingsPage user={user} />}</Protected>} />
        <Route path="/audit" element={<Protected>{() => <AuditLogPage />}</Protected>} />
        <Route path="/events" element={<Protected>{() => <EventsPage />}</Protected>} />
        <Route path="/admin" element={<Protected>{() => <AdminPanelPage />}</Protected>} />
        <Route path="/shared" element={<Protected>{() => <SharedWithMePage />}</Protected>} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
