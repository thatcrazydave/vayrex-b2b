import { useState } from 'react';
import { Link } from 'react-router-dom';
import API from '../services/api';
import '../styles/auth.css';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');

    try {
      const response = await API.post('/auth/forgot-password', { email });
      
      if (response.data.success) {
        setMessage(response.data.message);
        setEmail(''); // Clear email field
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h2>Forgot Password</h2>
          <p>Enter your email address and we'll send you a link to reset your password</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {message && (
            <div className="alert alert-success">
              <span className="alert-icon">✓</span>
              {message}
            </div>
          )}

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

          <button 
            type="submit" 
            className="btn btn-primary btn-block"
            disabled={loading}
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
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
