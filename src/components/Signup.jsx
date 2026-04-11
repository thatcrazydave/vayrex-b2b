import React, { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth, getDashboardRoute } from "../contexts/AuthContext.jsx";
import { validateSignupForm } from "../utils/validation.js";
import { FiEye, FiEyeOff } from 'react-icons/fi';
import { showToast } from "../utils/toast.js";
import "../styles/auth.css";
import api from '../services/api.js';

const Signup = () => {
  const [formData, setFormData] = useState({
    fullname: "",
    username: "",
    email: "",
    password: "",
    confirmPassword: ""
  });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [inviteData, setInviteData] = useState(null); // { invite, org } from accept-invite endpoint
  const [inviteLoading, setInviteLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('inviteToken');
  // Persist the token in state so URL changes after load don't lose it
  const [savedInviteToken, setSavedInviteToken] = useState(() => searchParams.get('inviteToken'));

  const { signup, loading, error, clearError, isAuthenticated, isInitialized, user } = useAuth();
  const navigate = useNavigate();

  // Redirect if already authenticated as a confirmed org member (has tenantSubdomain).
  // Newly signed-up users won't have tenantSubdomain yet, so this is a no-op for them.
  useEffect(() => {
    if (isAuthenticated && isInitialized && user?.tenantSubdomain) {
      window.location.replace(`https://${user.tenantSubdomain}`);
    }
  }, [isAuthenticated, isInitialized, user]);

  // Show error toast when error occurs
  useEffect(() => {
    if (error) {
      showToast.error(error);
      clearError();
    }
  }, [error, clearError]);

  // Fetch invite details if inviteToken present in URL
  useEffect(() => {
    if (!inviteToken) return;
    setSavedInviteToken(inviteToken); // keep the token even if URL later changes
    setInviteLoading(true);
    api.get(`/auth/accept-invite/${encodeURIComponent(inviteToken)}`)
      .then((res) => {
        if (res.data.success) {
          setInviteData(res.data);
          // Pre-fill and lock email to the invited address
          if (res.data.invite?.email) {
            setFormData((f) => ({ ...f, email: res.data.invite.email }));
          }
        }
      })
      .catch(() => {
        showToast.warning('This invitation link may have expired or already been used.');
      })
      .finally(() => setInviteLoading(false));
  }, [inviteToken]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    // Clear error for this field when user starts typing
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

    // Validate form
    const validation = validateSignupForm(formData);

    if (!validation.isValid) {
      setErrors(validation.errors);
      // Mark all fields as touched to show errors
      setTouched({
        fullname: true,
        username: true,
        email: true,
        password: true,
        confirmPassword: true
      });
      // Show first error as toast
      const firstError = Object.values(validation.errors)[0];
      showToast.warning(firstError);
      return;
    }

    // All validation passed, proceed with signup
    // Use savedInviteToken (persisted at mount) as fallback in case URL changed
    const activeInviteToken = inviteToken || savedInviteToken;
    const signupPayload = { ...formData };
    if (activeInviteToken) signupPayload.inviteToken = activeInviteToken;

    const result = await signup(signupPayload);
    if (result.success) {
      if (inviteData?.org) {
        showToast.success(`Account created! You're now a member of ${inviteData.org.name}. Check your email to verify.`);
      } else {
        showToast.success("Account created! Please check your email to verify your account.");
      }
      setTimeout(() => navigate(`/verify-email?email=${encodeURIComponent(formData.email)}`), 2000);
    } else if (result.pending) {
      if (activeInviteToken) {
        showToast.error('There was a problem processing your invite. Please use the original invite link again or contact your admin.');
      } else {
        showToast.info('Account created! Please check your email to verify your account.');
        setTimeout(() => navigate(`/verify-email?email=${encodeURIComponent(formData.email)}`), 3000);
      }
    } else if (result.code === 'USER_EXISTS' && activeInviteToken) {
      // Existing user trying to accept an invite — redirect to login with token preserved
      showToast.info(result.error || 'You already have an account. Please log in to accept the invitation.');
      setTimeout(() => navigate(`/Login?inviteToken=${encodeURIComponent(activeInviteToken)}`), 2000);
    } else {
      showToast.error(result.error || 'Signup failed');
    }
  };

  // Eye Icon Component
  const EyeIcon = () => <FiEye size={20} />;

  // Eye Off Icon Component
  const EyeOffIcon = () => <FiEyeOff size={20} />;

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>Create Account</h2>
        <p className="auth-subtitle">
          {inviteData?.org ? `Join ${inviteData.org.name} on Vayrex` : 'Create your account'}
        </p>

        {/* Invite Banner */}
        {inviteToken && (
          <div style={{ background: '#e8f0fe', border: '1.5px solid #c5cae9', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#1a237e' }}>
            {inviteLoading
              ? 'Validating invitation…'
              : inviteData
              ? `You have been invited to join ${inviteData.org?.name || 'an organisation'} as ${inviteData.invite?.orgRole?.replace('_', ' ')}.`
              : 'This invitation link is invalid or has expired.'}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form" autoComplete="off" noValidate>

          {/* Full Name Input */}
          <div className="form-group">
            <input
              type="text"
              name="fullname"
              placeholder="Full Name"
              value={formData.fullname}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`form-input ${errors.fullname ? 'error' : ''}`}
              disabled={loading}
            />
            {touched.fullname && errors.fullname && (
              <span className="error-message">{errors.fullname}</span>
            )}
          </div>

          {/* Username Input */}
          <div className="form-group">
            <input
              type="text"
              name="username"
              placeholder="Username"
              value={formData.username}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`form-input ${errors.username ? 'error' : ''}`}
              disabled={loading}
            />
            {touched.username && errors.username && (
              <span className="error-message">{errors.username}</span>
            )}
          </div>

          {/* Email Input */}
          <div className="form-group">
            <input
              type="email"
              name="email"
              placeholder="Email Address"
              value={formData.email}
              onChange={handleChange}
              onBlur={handleBlur}
              className={`form-input ${errors.email ? 'error' : ''}`}
              disabled={loading || !!inviteData}
              readOnly={!!inviteData}
            />
            {touched.email && errors.email && (
              <span className="error-message">{errors.email}</span>
            )}
          </div>

          {/* Password Input */}
          <div className="form-group">
            <div className="password-input-container">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                placeholder="Password (min. 8 characters)"
                value={formData.password}
                onChange={handleChange}
                onBlur={handleBlur}
                className={`form-input ${errors.password ? 'error' : ''}`}
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {touched.password && errors.password && (
              <span className="error-message">{errors.password}</span>
            )}
          </div>

          {/* Confirm Password Input */}
          <div className="form-group">
            <div className="password-input-container">
              <input
                type={showConfirmPassword ? "text" : "password"}
                name="confirmPassword"
                placeholder="Confirm Password"
                value={formData.confirmPassword}
                onChange={handleChange}
                onBlur={handleBlur}
                className={`form-input ${errors.confirmPassword ? 'error' : ''}`}
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                disabled={loading}
                aria-label="Toggle confirm password visibility"
              >
                {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {touched.confirmPassword && errors.confirmPassword && (
              <span className="error-message">{errors.confirmPassword}</span>
            )}
          </div>

          {/* Sign Up Button */}
          <button
            type="submit"
            className="auth-button"
            disabled={loading}
          >
            {loading ? "Creating Account..." : "Sign Up"}
          </button>

          {/* Sign In Link */}
          <p className="auth-link">
            Already have an account? <Link to="/Login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default Signup;
