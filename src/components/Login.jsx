import React, { useState, useEffect } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import { FaGoogle } from 'react-icons/fa';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import { showToast } from "../utils/toast.js";
import "../styles/auth.css";

const Login = () => {
  const [formData, setFormData] = useState({
    emailOrUsername: "",
    password: ""
  });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  
  const { 
    login, 
    loginWithGoogle, 
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

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && isInitialized && user) {

      // Determine redirect destination based on role
      let redirectTo = '/Dashboard';
      
      // Check if user is admin/superadmin (multiple sources for safety)
      const userIsAdmin = isAdmin || 
                         user.role === 'admin' || 
                         user.role === 'superadmin' || 
                         user.isAdmin === true;
      
      if (userIsAdmin) {
        // Admin users go to admin dashboard
        if (from && from.startsWith('/admin')) {
          redirectTo = from; // Return to protected admin route they tried to access
        } else {
          redirectTo = '/admin'; // Default to admin dashboard
        }
      } else {
        // Regular users go to user dashboard
        if (from && !from.startsWith('/admin')) {
          redirectTo = from; // Return to protected route they tried to access
        } else {
          redirectTo = '/Dashboard'; // Default to user dashboard
        }
      }

      // console.log('Login redirect:', { userIsAdmin, role: user.role, redirectTo });
      navigate(redirectTo, { replace: true });
    }
  }, [isAuthenticated, isInitialized, user, isAdmin, navigate, from]);

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
      const userIsAdmin = result.isAdmin || loggedInUser?.isAdmin || 
                          loggedInUser?.role === 'admin' || 
                          loggedInUser?.role === 'superadmin';
      

      // Show tier info in toast
      const tierEmoji = {
        free: '🆓',
        starter: '⭐',
        pro: '💎'
      }[loggedInUser?.subscriptionTier] || ' ';
      
      const roleLabel = userIsAdmin ? ' (Admin)' : '';
      showToast.success(
        `Welcome back${roleLabel}! (${(loggedInUser?.subscriptionTier || 'free').toUpperCase()} tier)`
      );
      
      // Determine redirect destination
      let redirectTo = result.redirectTo || '/Dashboard';
      
      if (userIsAdmin) {
        // If coming from an admin page, go back there
        if (from && from.startsWith('/admin')) {
          redirectTo = from;
        } else {
          redirectTo = '/admin';
        }
      } else {
        // Regular user
        if (from && !from.startsWith('/admin')) {
          redirectTo = from;
        } else {
          redirectTo = '/Dashboard';
        }
      }

      // Navigate after a short delay for toast visibility
      setTimeout(() => {
        navigate(redirectTo, { replace: true });
      }, 300);
    } else {
      showToast.error(result.error || "Login failed. Please try again.");
    }
  };

  const handleGoogleLogin = async () => {
    try {
      showToast.info("Redirecting to Google...");
      const result = await loginWithGoogle();
      
      if (result?.success) {
        const loggedInUser = result.user;
        const userIsAdmin = result.isAdmin || loggedInUser?.isAdmin || 
                            loggedInUser?.role === 'admin' || 
                            loggedInUser?.role === 'superadmin';

        // Determine redirect
        let redirectTo = result.redirectTo || '/Dashboard';
        
        if (userIsAdmin) {
          if (from && from.startsWith('/admin')) {
            redirectTo = from;
          } else {
            redirectTo = '/admin';
          }
        } else {
          if (from && !from.startsWith('/admin')) {
            redirectTo = from;
          } else {
            redirectTo = '/Dashboard';
          }
        }

        showToast.success('Welcome!');
        navigate(redirectTo, { replace: true });
      }
    } catch (err) {
      console.error('Google login error:', err);
      showToast.error("Google login failed. Please try again.");
    }
  };

  // Don't render login form if already authenticated (prevents flash)
  if (isAuthenticated && isInitialized) {
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

          <div className="auth-divider">
            <span>or</span>
          </div>

          <button 
            type="button" 
            className="google-button"
            onClick={handleGoogleLogin}
            disabled={loading}
          >
            <FaGoogle />
            Continue with Google
          </button>

          <p className="auth-link">
            Don't have an account? <Link to="/Signup">Sign up</Link>
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
