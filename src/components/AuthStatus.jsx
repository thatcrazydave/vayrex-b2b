import React from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import LoadingSpinner from './LoadingSpinner.jsx';

const AuthStatus = ({ children }) => {
  const { loading, isInitialized, error, isAuthenticated } = useAuth();

  // Show loading while initializing
  if (!isInitialized || loading) {
    return <LoadingSpinner message="Initializing authentication..." />;
  }

  // Show error if there's a critical auth error
  if (error && !isAuthenticated) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-error">
            {error}
          </div>
          <button 
            className="auth-button"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return children;
};

export default AuthStatus;
