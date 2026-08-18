import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import "./App.css";

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

// Lazy-loaded pages (heavy dependencies like recharts)
const FormReportsPage = lazy(() => import("./pages/FormReportsPage"));

function LazyFallback() {
  return (
    <main className="page-shell">
      <div className="status-card">
        <p>Loading...</p>
      </div>
    </main>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        {/* Public form routes */}
        <Route path="/f/:slug" element={<PublicFormPage />} />
        <Route path="/f/:slug/display" element={<QRDisplayPage />} />

        {/* Dashboard routes */}
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/forms/new" element={<CreateFormPage />} />
        <Route path="/forms/:formId/edit" element={<FormEditorPage />} />
        <Route path="/forms/:formId/responses" element={<ResponseDashboardPage />} />
        <Route path="/forms/:formId/reports" element={<Suspense fallback={<LazyFallback />}><FormReportsPage /></Suspense>} />
        <Route path="/forms/:formId/share" element={<FormSharePage />} />
        <Route path="/folders" element={<FoldersPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />

        {/* Legacy public form route (for backwards compatibility) */}
        <Route path="/forms/:slug" element={<PublicFormPage />} />

        {/* Fallback */}
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
