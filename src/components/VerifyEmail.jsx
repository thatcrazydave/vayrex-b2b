import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import API from '../services/api';
import '../styles/auth.css';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying'); // verifying, success, error, manual
  const [message, setMessage] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [email, setEmail] = useState(() => searchParams.get('email') || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    
    if (!token) {
      // No token, show manual code entry form
      setStatus('manual');
      setMessage('Enter the 6-digit verification code sent to your email');
      return;
    }

    verifyEmailWithToken(token);
  }, [searchParams]);

  const verifyEmailWithToken = async (token) => {
    try {
      const response = await API.get(`/auth/verify-email/${token}`);
      
      if (response.data.success) {
        setStatus('success');
        setMessage(response.data.message);
        
        // Redirect to login after 3 seconds
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      }
    } catch (error) {
      setStatus('manual');
      setError(error.response?.data?.error?.message || 'Token verification failed. Please try entering your code manually.');
    }
  };

  const handleCodeSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await API.post('/auth/verify-email-code', {
        email: email.toLowerCase(),
        code: verificationCode
      });
      
      if (response.data.success) {
        setStatus('success');
        setMessage(response.data.message);
        
        // Redirect to login after 3 seconds
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      }
    } catch (error) {
      setError(error.response?.data?.error?.message || 'Code verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h2>Email Verification</h2>
        </div>

        <div className="auth-body">
          {status === 'verifying' && (
            <div className="verification-status">
              <div className="spinner"></div>
              <p>Verifying your email address...</p>
            </div>
          )}

          {status === 'manual' && (
            <form onSubmit={handleCodeSubmit} className="auth-form">
              <p className="text-center" style={{ marginBottom: '20px' }}>
                {message}
              </p>

              {error && (
                <div className="alert alert-error">
                  <span className="alert-icon">✗</span>
                  {error}
                </div>
              )}

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
                <label htmlFor="code">Verification Code</label>
                <input
                  type="text"
                  id="code"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
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

              <button 
                type="submit" 
                className="btn btn-primary btn-block"
                disabled={loading || verificationCode.length !== 6}
              >
                {loading ? 'Verifying...' : 'Verify Email'}
              </button>

              <div className="auth-footer">
                <button 
                  type="button"
                  onClick={() => navigate('/login')}
                  className="auth-link"
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  ← Back to Login
                </button>
              </div>
            </form>
          )}

          {status === 'success' && (
            <div className="verification-status success">
              <div className="success-icon">✓</div>
              <h3>Email Verified!</h3>
              <p>{message}</p>
              <p className="redirect-message">Redirecting to login...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
