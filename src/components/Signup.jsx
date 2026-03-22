import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import { validateSignupForm } from "../utils/validation.js";
import { FaGoogle } from 'react-icons/fa';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import { showToast } from "../utils/toast.js";
import "../styles/auth.css";

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
  
  const { signup, loginWithGoogle, loading, error, clearError, isAuthenticated, isInitialized } = useAuth();
  const navigate = useNavigate();

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && isInitialized) {
      navigate("/Dashboard");
    }
  }, [isAuthenticated, isInitialized, navigate]);

  // Show error toast when error occurs
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
    const { confirmPassword, ...signupData } = formData;
    
    const result = await signup(formData);
    if (result.success) {
      showToast.success("Account created! Please check your email to verify your account.");
      setTimeout(() => navigate("/login"), 2000);
    } else {
      showToast.error(result.error || "Signup failed");
    }
  };

  const handleGoogleLogin = async () => {
    try {
      showToast.info("Redirecting to Google...");
      await loginWithGoogle();
    } catch (err) {
      showToast.error("Google signup failed. Please try again.");
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
        <p className="auth-subtitle">Join Vayrex and start learning</p>
        
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
              disabled={loading}
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

          {/* Divider */}
          <div className="auth-divider">
            <span>or</span>
          </div>

          {/* Google Button */}
          <button 
            type="button" 
            className="google-button"
            onClick={handleGoogleLogin}
            disabled={loading}
          >
            <FaGoogle />
            Continue with Google
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
