import React, { useState, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import PageLoader from './PageLoader.jsx';

const AdminRoute = ({ children }) => {
  const { user, loading, isInitialized, isAdmin } = useAuth();
  const location = useLocation();
  const [backendVerified, setBackendVerified] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [verificationError, setVerificationError] = useState(null);

  // Double verification: Check with backend on mount
  useEffect(() => {
    let mounted = true;

    const verifyAdminAccess = async () => {
      // Skip if still loading or not logged in
      if (loading || !isInitialized || !user) {
        return;
      }

      try {
        // Make a lightweight request to admin endpoint to verify access
        const response = await api.get('/admin/verify-access');
        
        if (mounted && response.data.success) {
          setBackendVerified(true);
          setVerificationError(null);
        } else if (mounted) {
          setBackendVerified(false);
          setVerificationError('Backend verification failed');
        }
      } catch (error) {
        console.error('Admin verification failed:', error);
        
        if (mounted) {
          setBackendVerified(false);
          setVerificationError(
            error.response?.data?.error?.message || 
            'Unable to verify admin access'
          );
        }
      } finally {
        if (mounted) {
          setVerifying(false);
        }
      }
    };

    verifyAdminAccess();

    return () => {
      mounted = false;
    };
  }, [user, loading, isInitialized]);

  // Show loading state while checking auth or verifying with backend
  if (loading || !isInitialized || verifying) {
    return <PageLoader />;
  }

  // Not logged in - redirect to login
  if (!user) {
    return <Navigate to="/Login" state={{ from: location }} replace />;
  }

  // Check admin status using multiple sources (client-side check)
  const hasAdminAccess = 
    isAdmin || 
    user?.isAdmin || 
    user?.role === 'admin' || 
    user?.role === 'superadmin';

  // CRITICAL: Verification complete - check results
  // Only deny access if we're NOT verifying AND (user is not admin OR backend verification failed)
  if (!hasAdminAccess || !backendVerified) {
    // Only log and redirect if we have actual admin status to check
    // (verifying is false at this point due to the check above)
    console.warn('Admin access denied:', {
      hasAdminAccess,
      backendVerified,
      userRole: user?.role,
      error: verificationError,
      timestamp: new Date().toISOString()
    });
    
    // Redirect to appropriate dashboard based on role
    const redirectPath = user ? '/Dashboard' : '/Login';
    return <Navigate to={redirectPath} state={{ from: location }} replace />;
  }

  // DOUBLE VERIFIED: Client-side AND backend verified - allow access
  return children;
};

export default AdminRoute;