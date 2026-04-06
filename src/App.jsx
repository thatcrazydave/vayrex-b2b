import React, { Suspense, useEffect, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { TenantProvider, useTenant } from './contexts/TenantContext.jsx';
import Nav from './Nav.jsx';
import Footer from './components/Footer.jsx';
import PageLoader from './components/PageLoader.jsx';

// ── Auth guards ─────────────────────────────────────────────────────────────
import { useAuth } from './contexts/AuthContext.jsx';

function OrgRoute({ children, allowedRoles }) {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAuthenticated || !user?.orgRole) return <Navigate to="/Login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.orgRole)) return <Navigate to="/" replace />;
  return children;
}

// ── Public pages ─────────────────────────────────────────────────────────────
const Home           = lazy(() => import('./Home.jsx'));
const About          = lazy(() => import('./components/About.jsx'));
const Contact        = lazy(() => import('./components/Contact.jsx'));
const Signup         = lazy(() => import('./components/Signup.jsx'));
const Login          = lazy(() => import('./components/Login.jsx'));
const VerifyEmail    = lazy(() => import('./components/VerifyEmail.jsx'));
const ForgotPassword = lazy(() => import('./components/ForgotPassword.jsx'));
const ResetPassword  = lazy(() => import('./components/ResetPassword.jsx'));
const SchoolsLanding = lazy(() => import('./components/SchoolsLanding.jsx'));
const OrgSignup      = lazy(() => import('./components/OrgSignup.jsx'));
const OrgSetupWizard = lazy(() => import('./components/OrgSetupWizard.jsx'));
const Pricing        = lazy(() => import('./components/Pricing.jsx'));
const TenantHome     = lazy(() => import('./components/TenantHome.jsx'));
const BrandingManager = lazy(() => import('./components/BrandingManager.jsx'));

// ── Role-scoped dashboards (per master plan Section 12) ──────────────────────
const OrgAdminDashboard = lazy(() => import('./components/OrgAdminDashboard.jsx'));
const TeacherDashboard  = lazy(() => import('./components/TeacherDashboard.jsx'));
const StudentDashboard  = lazy(() => import('./components/StudentDashboard.jsx'));
const StudentAssignmentView = lazy(() => import('./components/StudentAssignmentView.jsx'));
const GuardianPortal    = lazy(() => import('./components/GuardianPortal.jsx'));
const MembersManager    = lazy(() => import('./components/MembersManager.jsx'));
const AcademicCalendar  = lazy(() => import('./components/AcademicCalendar.jsx'));
const ClassManager      = lazy(() => import('./components/ClassManager.jsx'));
const GradeBook         = lazy(() => import('./components/GradeBook.jsx'));
const AttendanceMarker  = lazy(() => import('./components/AttendanceMarker.jsx'));
const AnnouncementComposer = lazy(() => import('./components/AnnouncementComposer.jsx'));
const ReportCardView    = lazy(() => import('./components/ReportCardView.jsx'));
const GradingSettings   = lazy(() => import('./components/GradingSettings.jsx'));

// ── Teacher B2C features (role-gated) ────────────────────────────────────────
const Upload            = lazy(() => import('./components/Upload.jsx'));
const Learning          = lazy(() => import('./components/Learning.jsx'));
const GenerateQuiz      = lazy(() => import('./components/GenerateQuiz.jsx'));
const AssignmentManager = lazy(() => import('./components/AssignmentManager.jsx'));

// ── Vayrex super-admin ───────────────────────────────────────────────────────
const Admin = lazy(() => import('./components/AdminDashboard.jsx'));

// ── Platform routes (no subdomain / marketing host) ─────────────────────────
function PlatformRoutes() {
  return (
    <Routes>
      <Route path="/"                  element={<Home />} />
      <Route path="/about"             element={<About />} />
      <Route path="/contact"           element={<Contact />} />
      <Route path="/org-signup"        element={<OrgSignup />} />
      <Route path="/pricing"           element={<Pricing />} />
      <Route path="/Login"             element={<Login />} />
      <Route path="/login"             element={<Login />} />
      {/* /for-schools is now the tenant portal template — redirect to signup on platform host */}
      <Route path="/for-schools"       element={<Navigate to="/org-signup" replace />} />

      {/* Vayrex super-admin stays on platform host */}
      <Route path="/admin"   element={<Admin />} />
      <Route path="/admin/*" element={<Admin />} />

      {/* Any other path on the platform host → school registration */}
      <Route path="*" element={<Navigate to="/for-schools" replace />} />
    </Routes>
  );
}

// ── Tenant routes (subdomain resolved to an active org) ─────────────────────
function TenantRoutes() {
  return (
    <Routes>
      {/* ── Tenant home (branded landing / sign-in prompt) ────── */}
      <Route path="/"                  element={<TenantHome />} />

      {/* ── Auth ─────────────────────────────────────────────── */}
      <Route path="/Login"             element={<Login />} />
      <Route path="/Signup"            element={<Signup />} />
      <Route path="/verify-email"      element={<VerifyEmail />} />
      <Route path="/forgot-password"   element={<ForgotPassword />} />
      <Route path="/reset-password"    element={<ResetPassword />} />

      {/* ── Org setup wizard (owner / it_admin) ─── */}
      <Route path="/org-setup" element={
        <OrgRoute allowedRoles={['owner', 'it_admin']}>
          <OrgSetupWizard />
        </OrgRoute>
      } />

      {/* ── Principal / Org Admin dashboard ──────── */}
      <Route path="/org-admin" element={
        <OrgRoute allowedRoles={['owner', 'org_admin', 'it_admin']}>
          <OrgAdminDashboard />
        </OrgRoute>
      } />
      <Route path="/org-admin/members" element={
        <OrgRoute allowedRoles={['owner', 'org_admin']}>
          <MembersManager />
        </OrgRoute>
      } />
      <Route path="/org-admin/academic" element={
        <OrgRoute allowedRoles={['owner', 'org_admin', 'it_admin']}>
          <AcademicCalendar />
        </OrgRoute>
      } />
      <Route path="/org-admin/classes" element={
        <OrgRoute allowedRoles={['owner', 'org_admin', 'it_admin']}>
          <ClassManager />
        </OrgRoute>
      } />
      <Route path="/org-admin/gradebook" element={
        <OrgRoute allowedRoles={['owner', 'org_admin']}>
          <GradeBook />
        </OrgRoute>
      } />
      <Route path="/org-admin/report-cards" element={
        <OrgRoute allowedRoles={['owner', 'org_admin']}>
          <ReportCardView />
        </OrgRoute>
      } />
      <Route path="/org-admin/announcements" element={
        <OrgRoute allowedRoles={['owner', 'org_admin']}>
          <AnnouncementComposer />
        </OrgRoute>
      } />
      <Route path="/org-admin/attendance" element={
        <OrgRoute allowedRoles={['owner', 'org_admin']}>
          <AttendanceMarker />
        </OrgRoute>
      } />
      <Route path="/org-admin/grading-settings" element={
        <OrgRoute allowedRoles={['owner', 'org_admin']}>
          <GradingSettings />
        </OrgRoute>
      } />
      <Route path="/org-admin/branding" element={
        <OrgRoute allowedRoles={['owner', 'org_admin']}>
          <BrandingManager />
        </OrgRoute>
      } />

      {/* ── Teacher dashboard ─────────────────────── */}
      <Route path="/teacher" element={
        <OrgRoute allowedRoles={['teacher', 'org_admin', 'owner']}>
          <TeacherDashboard />
        </OrgRoute>
      } />
      <Route path="/teacher/gradebook" element={
        <OrgRoute allowedRoles={['teacher', 'org_admin', 'owner']}>
          <GradeBook />
        </OrgRoute>
      } />
      <Route path="/teacher/attendance" element={
        <OrgRoute allowedRoles={['teacher', 'org_admin', 'owner']}>
          <AttendanceMarker />
        </OrgRoute>
      } />
      <Route path="/teacher/announcements" element={
        <OrgRoute allowedRoles={['teacher', 'org_admin', 'owner']}>
          <AnnouncementComposer />
        </OrgRoute>
      } />
      <Route path="/teacher/report-cards" element={
        <OrgRoute allowedRoles={['teacher', 'org_admin', 'owner']}>
          <ReportCardView />
        </OrgRoute>
      } />
      <Route path="/teacher/upload" element={
        <OrgRoute allowedRoles={['teacher', 'org_admin', 'owner']}>
          <Upload />
        </OrgRoute>
      } />
      <Route path="/teacher/learning" element={
        <OrgRoute allowedRoles={['teacher', 'org_admin', 'owner']}>
          <Learning />
        </OrgRoute>
      } />
      <Route path="/teacher/generate-quiz" element={
        <OrgRoute allowedRoles={['teacher', 'org_admin', 'owner']}>
          <GenerateQuiz />
        </OrgRoute>
      } />
      <Route path="/teacher/assignments" element={
        <OrgRoute allowedRoles={['teacher', 'org_admin', 'owner']}>
          <AssignmentManager />
        </OrgRoute>
      } />

      {/* ── Student dashboard ─────────────────────── */}
      <Route path="/student" element={
        <OrgRoute allowedRoles={['student']}>
          <StudentDashboard />
        </OrgRoute>
      } />
      <Route path="/student/assignments/:id" element={
        <OrgRoute allowedRoles={['student']}>
          <StudentAssignmentView />
        </OrgRoute>
      } />
      <Route path="/student/report-card" element={
        <OrgRoute allowedRoles={['student']}>
          <ReportCardView />
        </OrgRoute>
      } />

      {/* ── Guardian portal ───────────────────────── */}
      <Route path="/guardian-portal" element={
        <OrgRoute allowedRoles={['guardian']}>
          <GuardianPortal />
        </OrgRoute>
      } />

      {/* ── Catch-all on tenant host → home ──────── */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

const AppContent = () => {
  const location = useLocation();
  const { isTenantHost, loading: tenantLoading } = useTenant();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Wait for tenant resolution to avoid flash of wrong shell
  if (tenantLoading) return <PageLoader />;

  const isAdminRoute = location.pathname.startsWith('/admin');

  return (
    <>
      {!isAdminRoute && <Nav />}

      <Suspense fallback={<PageLoader />}>
        {isTenantHost ? <TenantRoutes /> : <PlatformRoutes />}
      </Suspense>

      {!isAdminRoute && <Footer />}

      <ToastContainer
        position="bottom-right"
        autoClose={4000}
        hideProgressBar={false}
        newestOnTop={true}
        closeOnClick={true}
        rtl={false}
        pauseOnFocusLoss={true}
        draggable={true}
        pauseOnHover={true}
        theme="light"
        style={{ zIndex: 9999 }}
      />
    </>
  );
};

function App() {
  return (
    <Router>
      <TenantProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </TenantProvider>
    </Router>
  );
}

export default App;
