import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";

import "./App.css";

import AuthGuard from "./components/AuthGuard";
import AppLayout from "./components/AppLayout";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import DashboardPage from "./pages/DashboardPage";
import CreateFormPage from "./pages/CreateFormPage";
import FormEditorPage from "./pages/FormEditorPage";
import FormSharePage from "./pages/FormSharePage";
import ResponseDashboardPage from "./pages/ResponseDashboardPage";
import PublicFormPage from "./pages/PublicFormPage";
import QRDisplayPage from "./pages/QRDisplayPage";
import TeamPage from "./pages/TeamPage";
import FoldersPage from "./pages/FoldersPage";
import NotificationsPage from "./pages/NotificationsPage";
import SettingsPage from "./pages/SettingsPage";
import AuditLogPage from "./pages/AuditLogPage";
import { getToken } from "./lib/api";

// Lazy-loaded pages (heavy dependencies like recharts)
const FormReportsPage = lazy(() => import("./pages/FormReportsPage"));

function LazyFallback() {
  return (
    <main className="page-shell">
      <div className="status-card">
        <div className="skeleton-block" style={{ width: 180, height: 20, margin: "0 auto" }} />
      </div>
    </main>
  );
}

/** Redirects logged-in users away from auth pages */
function GuestOnly({ children }: { children: React.ReactNode }) {
  if (getToken()) {
    return <Navigate to="/dashboard" replace />;
  }
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
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPage />} />
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
        <Route path="/forms/:formId/responses" element={<Protected>{() => <ResponseDashboardPage />}</Protected>} />
        <Route path="/forms/:formId/reports" element={<Protected>{() => <Suspense fallback={<LazyFallback />}><FormReportsPage /></Suspense>}</Protected>} />
        <Route path="/forms/:formId/share" element={<Protected>{() => <FormSharePage />}</Protected>} />
        <Route path="/folders" element={<Protected>{() => <FoldersPage />}</Protected>} />
        <Route path="/team" element={<Protected>{() => <TeamPage />}</Protected>} />
        <Route path="/notifications" element={<Protected>{() => <NotificationsPage />}</Protected>} />
        <Route path="/settings" element={<Protected>{(user) => <SettingsPage user={user} />}</Protected>} />
        <Route path="/audit" element={<Protected>{() => <AuditLogPage />}</Protected>} />

        {/* Legacy public form route */}
        <Route path="/forms/:slug" element={<PublicFormPage />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
