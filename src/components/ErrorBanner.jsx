import React from 'react';
import { getErrorMessage, createErrorBanner, CRITICAL_ERRORS } from '../utils/errorHandler';
import '../styles/errorBanner.css';

/**
 * ErrorBanner Component
 * Displays consistent error messages with appropriate styling and icons
 * Stops all loading indicators and provides clear feedback
 */
const ErrorBanner = ({ error, onRetry, onDismiss }) => {
  if (!error) return null;

  const errorDetails = typeof error === 'string' 
    ? { type: 'UNKNOWN_ERROR', message: error, shouldRetry: false }
    : getErrorMessage(error);
    
  const banner = createErrorBanner(errorDetails);

  const isCritical = [
    CRITICAL_ERRORS.SERVER_DOWN,
    CRITICAL_ERRORS.NETWORK_ERROR,
    CRITICAL_ERRORS.ACCOUNT_LOCKED,
    CRITICAL_ERRORS.AUTH_ERROR
  ].includes(errorDetails.type);

  return (
    <div 
      className={`error-banner ${isCritical ? 'error-banner-critical' : 'error-banner-warning'}`}
      style={{ borderLeftColor: banner.color }}
      role="alert"
    >
      <div className="error-banner-content">
        <div className="error-banner-icon">{banner.icon}</div>
        <div className="error-banner-text">
          <strong className="error-banner-title">
            {isCritical ? 'Critical Error' : 'Error'}
          </strong>
          <p className="error-banner-message">{banner.message}</p>
          
          {banner.retryAfter && (
            <p className="error-banner-retry-info">
              Please wait {banner.retryAfter} seconds before trying again.
            </p>
          )}

          {errorDetails.type === CRITICAL_ERRORS.SERVER_DOWN && (
            <p className="error-banner-help">
              • Check your internet connection<br />
              • Verify the server is running<br />
              • Try refreshing the page
            </p>
          )}

          {errorDetails.type === CRITICAL_ERRORS.ACCOUNT_LOCKED && (
            <p className="error-banner-help">
              Please contact support to unlock your account.
            </p>
          )}
        </div>
      </div>

      <div className="error-banner-actions">
        {banner.canRetry && onRetry && !banner.retryAfter && (
          <button 
            className="error-banner-button error-banner-button-retry"
            onClick={onRetry}
          >
            Retry
          </button>
        )}
        {onDismiss && (
          <button 
            className="error-banner-button error-banner-button-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};

export default ErrorBanner;
