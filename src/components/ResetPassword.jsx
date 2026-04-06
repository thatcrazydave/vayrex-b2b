import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import API from '../services/api';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import '../styles/auth.css';
import { showToast } from '../utils/toast';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordStrength, setPasswordStrength] = useState(null);
  const [token, setToken] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    const resetToken = searchParams.get('token');
    if (!resetToken) {
      // No token in URL, show code entry option
      setUseCode(true);
    } else {
      setToken(resetToken);
    }
  }, [searchParams]);

  const checkPasswordStrength = (pwd) => {
    const hasUpperCase = /[A-Z]/.test(pwd);
    const hasLowerCase = /[a-z]/.test(pwd);
    const hasNumbers = /\d/.test(pwd);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(pwd);
    const isLongEnough = pwd.length >= 8;

    const score = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChar, isLongEnough]
      .filter(Boolean).length;

    return {
      score,
      isValid: score >= 4 && isLongEnough,
      requirements: {
        minLength: isLongEnough,
        uppercase: hasUpperCase,
        lowercase: hasLowerCase,
        numbers: hasNumbers,
        special: hasSpecialChar
      }
    };
  };

  const handlePasswordChange = (e) => {
    const pwd = e.target.value;
    setPassword(pwd);
    if (pwd) {
      setPasswordStrength(checkPasswordStrength(pwd));
    } else {
      setPasswordStrength(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (passwordStrength && !passwordStrength.isValid) {
      setError('Password does not meet security requirements');
      return;
    }

    setLoading(true);

    try {
      let response;

      if (useCode) {
        // Reset with code
        response = await API.post('/auth/reset-password-code', {
          email: email.toLowerCase(),
          code: resetCode,
          password
        });
      } else {
        // Reset with token
        if (!token) {
          setError('Invalid reset link');
          setLoading(false);
          return;
        }
        response = await API.post(`/auth/reset-password/${token}`, { password });
      }

      if (response.data.success) {
        showToast.success(response.data.message || 'Password reset successfully!');
        setTimeout(() => navigate('/login'), 1500);
      }
    } catch (err) {
      const errorData = err.response?.data?.error;
      if (errorData?.details) {
        setError(errorData.details.join(', '));
      } else {
        setError(errorData?.message || 'Failed to reset password');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h2>Reset Password</h2>
          <p>{useCode ? 'Enter your email, code, and new password' : 'Enter your new password'}</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="alert alert-error">
              <span className="alert-icon">✗</span>
              {error}
            </div>
          )}

          {/* Toggle between token and code methods */}
          {!token && !useCode && (
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <button
                type="button"
                onClick={() => setUseCode(true)}
                className="auth-link"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a' }}
              >
                Have a code? Enter it manually →
              </button>
            </div>
          )}

          {useCode && (
            <>
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="code">Reset Code</label>
                <input
                  type="text"
                  id="code"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter 6-digit code"
                  maxLength="6"
                  required
                  disabled={loading}
                  style={{
                    fontSize: '24px',
                    letterSpacing: '8px',
                    textAlign: 'center',
                    fontFamily: 'monospace'
                  }}
                />
                <small style={{ color: '#666', display: 'block', marginTop: '5px' }}>
                  Enter the 6-digit code from your email
                </small>
              </div>
            </>
          )}

          <div className="form-group">
            <label htmlFor="password">New Password</label>
            <div className="password-input-container">
              <input
                type={showPassword ? "text" : "password"}
                id="password"
                value={password}
                onChange={handlePasswordChange}
                placeholder="Enter new password"
                required
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                aria-label="Toggle password visibility"
              >
                {showPassword ? (
                  <FiEye size={20} />
                ) : (
                  <FiEyeOff size={20} />
                )}
              </button>
            </div>

            {passwordStrength && (
              <div className="password-requirements">
                <div className={`requirement ${passwordStrength.requirements.minLength ? 'met' : ''}`}>
                  {passwordStrength.requirements.minLength ? '✓' : '○'} At least 8 characters
                </div>
                <div className={`requirement ${passwordStrength.requirements.uppercase ? 'met' : ''}`}>
                  {passwordStrength.requirements.uppercase ? '✓' : '○'} Uppercase letter
                </div>
                <div className={`requirement ${passwordStrength.requirements.lowercase ? 'met' : ''}`}>
                  {passwordStrength.requirements.lowercase ? '✓' : '○'} Lowercase letter
                </div>
                <div className={`requirement ${passwordStrength.requirements.numbers ? 'met' : ''}`}>
                  {passwordStrength.requirements.numbers ? '✓' : '○'} Number
                </div>
                <div className={`requirement ${passwordStrength.requirements.special ? 'met' : ''}`}>
                  {passwordStrength.requirements.special ? '✓' : '○'} Special character
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <div className="password-input-container">
              <input
                type={showConfirmPassword ? "text" : "password"}
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                disabled={loading}
                aria-label="Toggle confirm password visibility"
              >
                {showConfirmPassword ? (
                  <FiEye size={20} />
                ) : (
                  <FiEyeOff size={20} />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={loading || !passwordStrength?.isValid || (useCode && resetCode.length !== 6)}
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>

          <div className="auth-footer">
            <Link to="/login" className="auth-link">
              ← Back to Login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
