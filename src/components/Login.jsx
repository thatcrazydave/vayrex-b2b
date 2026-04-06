import React, { useState, useEffect } from "react";
import { useNavigate, Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth, getDashboardRoute } from "../contexts/AuthContext.jsx";
import { FiEye, FiEyeOff } from 'react-icons/fi';
import { showToast } from "../utils/toast.js";
import api from '../services/api.js';
import "../styles/auth.css";

const Login = () => {
  const [formData, setFormData] = useState({
    emailOrUsername: "",
    password: ""
  });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('inviteToken');

  const {
    login,
    loading,
    error,
    clearError,
    isAuthenticated,
    isInitialized,
    user,
    isAdmin
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Get the intended destination from state (if redirected from protected route)
  const from = location.state?.from?.pathname;

  // Redirect if already authenticated and there is a real dashboard to go to
  useEffect(() => {
    if (isAuthenticated && isInitialized && user) {
      const redirectTo = from || getDashboardRoute(user);
      if (redirectTo && redirectTo !== '/Login') {
        navigate(redirectTo, { replace: true });
      }
    }
  }, [isAuthenticated, isInitialized, user, navigate, from]);

  useEffect(() => {
    if (error) {
      showToast.error(error);
      clearError();
    }
  }, [error, clearError]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ""
      }));
    }
  };

  const handleBlur = (e) => {
    const { name } = e.target;
    setTouched(prev => ({
      ...prev,
      [name]: true
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Basic validation
    if (!formData.emailOrUsername.trim()) {
      setErrors(prev => ({ ...prev, emailOrUsername: 'Email or username is required' }));
      return;
    }
    if (!formData.password) {
      setErrors(prev => ({ ...prev, password: 'Password is required' }));
      return;
    }

    const result = await login(formData.emailOrUsername, formData.password);

    if (result.success) {
      const loggedInUser = result.user;

      // If the user arrived via an invite link, accept the invitation now
      if (inviteToken) {
        try {
          await api.post('/auth/accept-invite', { inviteToken });
          showToast.success(`Welcome back, ${loggedInUser?.fullname || loggedInUser?.username || ''}! Invitation accepted.`);
        } catch (inviteErr) {
          showToast.success(`Welcome back, ${loggedInUser?.fullname || loggedInUser?.username || ''}!`);
          showToast.warning(inviteErr.response?.data?.error?.message || 'Could not accept invitation. Please contact your admin.');
        }
      } else {
        showToast.success(
          `Welcome back, ${loggedInUser?.fullname || loggedInUser?.username || ''}!`
        );
      }

      // Use role-based redirect or return to previous page
      const redirectTo = from || result.redirectTo || getDashboardRoute(loggedInUser) || '/org-setup';

      // Navigate after a short delay for toast visibility
      setTimeout(() => {
        navigate(redirectTo, { replace: true });
      }, 300);
    } else {
      showToast.error(result.error || "Login failed. Please try again.");
    }
  };

  // Block login form only when there is a real dashboard to redirect to
  const dashboardRoute = isAuthenticated && isInitialized && user ? (from || getDashboardRoute(user)) : null;
  if (dashboardRoute && dashboardRoute !== '/Login') {
    return (
      <div className="auth-container">
        <div className="auth-card" style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
          <p>Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h2>Welcome Back</h2>
          <p className="auth-subtitle">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form" autoComplete="off" noValidate>
          <div className="form-group">
            <input
              id="emailOrUsername"
              type="text"
              name="emailOrUsername"
              placeholder="Enter your email or username"
              value={formData.emailOrUsername}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`form-input ${errors.emailOrUsername ? 'error' : ''}`}
              disabled={loading}
            />
            {touched.emailOrUsername && errors.emailOrUsername && (
              <span className="error-message">{errors.emailOrUsername}</span>
            )}
          </div>

          <div className="form-group">
            <div className="password-input-container">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                name="password"
                placeholder="Enter your password"
                value={formData.password}
                onChange={handleChange}
                onBlur={handleBlur}
                className={`form-input ${errors.password ? 'error' : ''}`}
                disabled={loading}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <FiEyeOff size={20} />
                ) : (
                  <FiEye size={20} />
                )}
              </button>
            </div>
            {touched.password && errors.password && (
              <span className="error-message">{errors.password}</span>
            )}
          </div>

          <button
            type="submit"
            className="auth-button"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                Signing In...
              </>
            ) : (
              "Sign In"
            )}
          </button>

          <p className="auth-link">
            Don't have an account? <Link to="/org-signup">Register your school</Link>
          </p>

          <p className="auth-link">
            <Link to="/forgot-password">Forgot your password?</Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default Login;
