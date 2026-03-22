import React, { Suspense, useEffect, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { AuthProvider } from './contexts/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminRoute from './components/AdminRoute.jsx';
import Nav from './Nav.jsx';
import Footer from './components/Footer.jsx';
import PageLoader from './components/PageLoader.jsx';

// Lazy-loaded page components — all share the single PageLoader during transitions
const Home = lazy(() => import('./Home.jsx'));
const About = lazy(() => import('./components/About.jsx'));
const Contact = lazy(() => import('./components/Contact.jsx'));
const Learning = lazy(() => import('./components/Learning.jsx'));
const Upload = lazy(() => import('./components/Upload.jsx'));
const Signup = lazy(() => import('./components/Signup.jsx'));
const Login = lazy(() => import('./components/Login.jsx'));
const Dashboard = lazy(() => import('./components/Dashboard.jsx'));
const ResultDetail = lazy(() => import('./components/ResultDetail.jsx'));
const Settings = lazy(() => import('./components/Settings.jsx'));
const GenerateQuiz = lazy(() => import('./components/GenerateQuiz.jsx'));
const Admin = lazy(() => import('./components/AdminDashboard.jsx'));
const VerifyEmail = lazy(() => import('./components/VerifyEmail.jsx'));
const ForgotPassword = lazy(() => import('./components/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./components/ResetPassword.jsx'));
const Pricing = lazy(() => import('./components/Pricing.jsx'));
const PaymentCallback = lazy(() => import('./components/PaymentCallback.jsx'));

// Wrapper component to access location
const AppContent = () => {
  const location = useLocation();
  
  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  
  // Check if current route is an admin route
  const isAdminRoute = location.pathname.startsWith('/admin');

  return (
    <>
      {/* Only show Nav if NOT on admin route */}
      {!isAdminRoute && <Nav />}
      
      {/* Page content changes based on URL — single PageLoader for all transitions */}
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/Signup" element={<Signup />} />
          <Route path="/Login" element={<Login />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/payment/callback" element={<PaymentCallback />} />
          
          {/* Protected User Routes */}
          <Route path="/learn" element={
            <ProtectedRoute>
              <Learning />
            </ProtectedRoute>
          } />
          <Route path="/Upload" element={
            <ProtectedRoute>
              <Upload />
            </ProtectedRoute>
          } />
          <Route path="/Dashboard" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />
          <Route path="/results/:resultId" element={
            <ProtectedRoute>
              <ResultDetail />
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          } />
          <Route path='/generate-quiz' element={
            <ProtectedRoute>
              <GenerateQuiz />
            </ProtectedRoute>
          } />

          {/* Admin Routes - Protected with Role Check */}
          <Route path="/admin" element={
            <AdminRoute>
              <Admin />
            </AdminRoute>
          } />
          <Route path="/admin/*" element={
            <AdminRoute>
              <Admin />
            </AdminRoute>
          } />
          
          {/* 404 Page */}
          <Route path="*" element={<h1>404 - Page Not Found</h1>} />
        </Routes>
      </Suspense>

      {/* Only show Footer if NOT on admin route */}
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
        style={{
          zIndex: 9999
        }}
      />
    </>
  );
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
}

export default App;
