import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { verifyPayment } from '../services/api.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { showToast } from '../utils/toast.js';
import { FiLoader, FiCheck, FiX } from 'react-icons/fi';
import '../styles/pricing.css';

const PaymentCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { updateUser, isAuthenticated, loading: authLoading, isInitialized } = useAuth();
  const [status, setStatus] = useState('verifying'); // verifying | success | error
  const [message, setMessage] = useState('Verifying your payment...');
  const verifiedRef = useRef(false);

  useEffect(() => {
    // Wait for auth to finish initializing before attempting verification
    if (authLoading || !isInitialized) return;
    if (verifiedRef.current) return;

    const reference = searchParams.get('reference') || searchParams.get('trxref');

    if (!reference) {
      setStatus('error');
      setMessage('No payment reference found. Please try again.');
      return;
    }

    // If user is authenticated, verify the payment
    if (isAuthenticated) {
      verifiedRef.current = true;
      verify(reference);
    } else {
      // User not authenticated — might have been logged out during redirect
      setStatus('success');
      setMessage('Payment received! Please log in to activate your upgraded plan. Your payment reference: ' + reference);
    }
  }, [searchParams, authLoading, isInitialized, isAuthenticated]);

  const verify = async (reference) => {
    try {
      const res = await verifyPayment(reference);

      if (res.success) {
        setStatus('success');
        const tier = res.data?.tier || 'upgraded';
        setMessage(`Payment successful! You are now on the ${tier.charAt(0).toUpperCase() + tier.slice(1)} plan.`);
        showToast.success('Payment verified successfully!');

        // Update user context with new tier
        if (updateUser && res.data?.tier) {
          updateUser({
            subscriptionTier: res.data.tier,
            subscriptionStatus: 'active'
          });
        }
      } else {
        setStatus('error');
        setMessage(res.error?.message || 'Payment verification failed. Please contact support.');
      }
    } catch (err) {
      console.error('Payment verification error:', err);

      // If 401/403, user session expired — still show a helpful message
      if (err.response?.status === 401 || err.response?.status === 403) {
        setStatus('success');
        setMessage('Payment received! Please log in to see your upgraded plan.');
        return;
      }

      const errMsg = err.response?.data?.error?.message || 'Unable to verify payment. Please contact support if you were charged.';
      setStatus('error');
      setMessage(errMsg);
    }
  };

  // Show loading while auth is initializing
  if (authLoading || !isInitialized) {
    return (
      <div className="payment-callback">
        <div className="callback-card">
          <div className="callback-icon verifying">
            <FiLoader size={36} />
          </div>
          <h2>Verifying Payment</h2>
          <p>Please wait...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="payment-callback">
      <div className="callback-card">
        <div className={`callback-icon ${status}`}>
          {status === 'verifying' && (
            <FiLoader size={36} />
          )}
          {status === 'success' && (
            <FiCheck size={36} strokeWidth={2.5} />
          )}
          {status === 'error' && (
            <FiX size={36} strokeWidth={2.5} />
          )}
        </div>

        <h2>
          {status === 'verifying' && 'Verifying Payment'}
          {status === 'success' && 'Payment Successful!'}
          {status === 'error' && 'Payment Issue'}
        </h2>

        <p>{message}</p>

        <div className="callback-actions">
          {status === 'success' && isAuthenticated && (
            <>
              <button
                className="btn-primary"
                onClick={() => navigate('/org-admin')}
                style={{ background: 'var(--primary-color)', color: '#fff', border: '2px solid var(--primary-color)' }}
              >
                Go to Dashboard
              </button>
              <button
                className="btn-secondary"
                onClick={() => navigate('/pricing')}
                style={{ background: 'transparent', color: 'var(--primary-color)', border: '2px solid var(--primary-color)' }}
              >
                View Plans
              </button>
            </>
          )}
          {status === 'success' && !isAuthenticated && (
            <>
              <button
                className="btn-primary"
                onClick={() => navigate('/Login')}
                style={{ background: 'var(--primary-color)', color: '#fff', border: '2px solid var(--primary-color)' }}
              >
                Log In
              </button>
            </>
          )}
          {status === 'error' && (
            <>
              <button
                className="btn-primary"
                onClick={() => navigate('/pricing')}
                style={{ background: 'var(--primary-color)', color: '#fff', border: '2px solid var(--primary-color)' }}
              >
                Try Again
              </button>
              <button
                className="btn-secondary"
                onClick={() => navigate('/contact')}
                style={{ background: 'transparent', color: 'var(--primary-color)', border: '2px solid var(--primary-color)' }}
              >
                Contact Support
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PaymentCallback;
