import React, { createContext, useContext, useState, useEffect } from 'react';
import API, { refreshCsrfToken } from '../services/api';
import { 
  signInWithGoogle, 
  handleGoogleRedirect,
  firebaseUserToAppUser,
  signOutUser
} from '../firebase/auth.js';
import { signOut } from 'firebase/auth';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Helper to manage auth user data in sessionStorage for tab isolation
const AuthStorage = {
  getUser: () => {
    try {
      const user = sessionStorage.getItem('user');
      return user ? JSON.parse(user) : null;
    } catch {
      return null;
    }
  },
  setUser: (user) => {
    sessionStorage.setItem('user', JSON.stringify(user));
  },
  clear: () => {
    sessionStorage.removeItem('user');
  }
};

// Tier configuration for display purposes
const TIER_CONFIG = {
  free: {
    name: 'Free',
    color: '#6b7280',
    badge: 'Free'
  },
  starter: {
    name: 'Starter',
    color: '#3b82f6',
    badge: 'Starter'
  },
  pro: {
    name: 'Pro',
    color: '#8b5cf6',
    badge: 'Pro'
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const updateUser = (updatedUserData) => {
    setUser(prevUser => {
      const newUser = { ...prevUser, ...updatedUserData };
      AuthStorage.setUser(newUser);
      return newUser;
    });
  };

  useEffect(() => {
    initializeAuth();
  }, []);

  useEffect(() => {
    checkGoogleRedirect();
  }, []);

  //  Fetch CSRF token on mount
  useEffect(() => {
    const initCsrf = async () => {
      try {
        await refreshCsrfToken();
        // console.log(' CSRF token initialized');
      } catch (err) {
        console.error('  CSRF initialization failed:', err);
      }
    };
    
    initCsrf();
  }, []);

  // Periodic cleanup for sessionStorage to prevent memory leaks
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      try {
        // Check user data size and clean up if too large (> 100KB)
        const userData = sessionStorage.getItem('user');
        if (userData && userData.length > 100000) {
          console.warn('User data in sessionStorage is too large, cleaning up');
          const user = JSON.parse(userData);
          // Keep only essential fields
          const essentialUser = {
            id: user.id,
            email: user.email,
            username: user.username,
            fullname: user.fullname,
            role: user.role,
            subscriptionTier: user.subscriptionTier,
            subscriptionStatus: user.subscriptionStatus,
            isAdmin: user.isAdmin,
            isSuperAdmin: user.isSuperAdmin,
            usage: user.usage,
            limits: user.limits
          };
          sessionStorage.setItem('user', JSON.stringify(essentialUser));
        }
        
        // Clean up expired tokens if user is not authenticated
        if (!user) {
          sessionStorage.removeItem('authToken');
          sessionStorage.removeItem('refreshToken');
        }
      } catch (err) {
        console.error('sessionStorage cleanup error:', err);
      }
    }, 5 * 60 * 1000); // Run every 5 minutes

    return () => clearInterval(cleanupInterval);
  }, [user]);

  // Custom API helper with enhanced CSRF handling
  // Note: The main API service (from api.js) already includes CSRF tokens automatically
  // via request interceptors. This helper is for special cases that need manual control.
  const api = {
    post: async (url, data) => {
      const csrfToken = sessionStorage.getItem('csrfToken');
      if (!csrfToken) {
        console.warn('CSRF token missing, attempting to refresh');
        await refreshCsrfToken();
      }
      const finalCsrfToken = sessionStorage.getItem('csrfToken');
      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CSRF-Token': finalCsrfToken || ''
        },
        credentials: 'include',
        body: JSON.stringify(data)
      });
    },
    put: async (url, data) => {
      const csrfToken = sessionStorage.getItem('csrfToken');
      if (!csrfToken) {
        console.warn('CSRF token missing, attempting to refresh');
        await refreshCsrfToken();
      }
      const finalCsrfToken = sessionStorage.getItem('csrfToken');
      return fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'CSRF-Token': finalCsrfToken || ''
        },
        credentials: 'include',
        body: JSON.stringify(data)
      });
    },
    delete: async (url, data) => {
      const csrfToken = sessionStorage.getItem('csrfToken');
      if (!csrfToken) {
        console.warn('CSRF token missing, attempting to refresh');
        await refreshCsrfToken();
      }
      const finalCsrfToken = sessionStorage.getItem('csrfToken');
      return fetch(url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'CSRF-Token': finalCsrfToken || ''
        },
        credentials: 'include',
        body: data ? JSON.stringify(data) : undefined
      });
    }
  };

  const checkGoogleRedirect = async () => {
    try {
      const firebaseUser = await handleGoogleRedirect();
      if (firebaseUser) {
        await processFirebaseUser(firebaseUser);
      }
    } catch (err) {
      console.error('Google redirect check error:', err);
    }
  };

  const initializeAuth = async () => {
    try {
      setLoading(true);

      // Check for access token in sessionStorage (tab-specific for true isolation)
      const accessToken = sessionStorage.getItem('authToken') || sessionStorage.getItem('accessToken');
      const refreshToken = sessionStorage.getItem('refreshToken');

      if (!sessionStorage.getItem('authToken') && accessToken) {
        sessionStorage.setItem('authToken', accessToken);
      }
      
      if (!accessToken && !refreshToken) {
        setUser(null);
        setIsInitialized(true);
        setLoading(false);
        return;
      }

      if (!accessToken && refreshToken) {
        try {
          const refreshResponse = await API.post('/auth/refresh', { refreshToken });
          
          if (refreshResponse.data.success) {
            const { accessToken: newToken, user: userData } = refreshResponse.data.data;
            
            // Store new access token in sessionStorage (tab-isolated)
            sessionStorage.setItem('authToken', newToken);
            
            const userWithRole = {
              ...userData,
              role: userData.role || 'user',
              isAdmin: userData.isAdmin || false,
              isSuperAdmin: userData.isSuperAdmin || false
            };
            
            AuthStorage.setUser(userWithRole);
            setUser(userWithRole);
            setIsInitialized(true);
            setLoading(false);
            return;
          }
        } catch (refreshError) {
          // No valid refresh token - user not authenticated in this tab
          setUser(null);
          AuthStorage.clear();
          setIsInitialized(true);
          setLoading(false);
          return;
        }
      }

      // We have an access token - verify it with backend
      try {
        const response = await API.get('/auth/verify');

        if (response.data.success) {
          const verifiedUser = response.data.data?.user;
          const isAdmin = response.data.data?.isAdmin;
          const isSuperAdmin = response.data.data?.isSuperAdmin;

          const finalUser = {
            ...verifiedUser,
            role: verifiedUser?.role || 'user',
            isAdmin: isAdmin || verifiedUser?.isAdmin || verifiedUser?.role === 'admin' || verifiedUser?.role === 'superadmin',
            isSuperAdmin: isSuperAdmin || verifiedUser?.isSuperAdmin || verifiedUser?.role === 'superadmin'
          };

          AuthStorage.setUser(finalUser);
          setUser(finalUser);
          setIsInitialized(true);
          setLoading(false);
          return;
        } else {
          throw new Error('Token verification failed');
        } 
      } catch (verifyError) {
        // Access token might be expired - try to refresh if we have refresh token
        const refreshToken = sessionStorage.getItem('refreshToken');
        
        if (refreshToken) {
          try {
            const refreshResponse = await API.post('/auth/refresh', { refreshToken });
            
            if (refreshResponse.data.success) {
              const { accessToken: newToken, refreshToken: newRefreshToken, user: userData } = refreshResponse.data.data;
              
              // Store new tokens in sessionStorage
              sessionStorage.setItem('authToken', newToken);
              sessionStorage.setItem('refreshToken', newRefreshToken);
              
              const userWithRole = {
                ...userData,
                role: userData.role || 'user',
                isAdmin: userData.isAdmin || userData.role === 'admin' || userData.role === 'superadmin',
                isSuperAdmin: userData.isSuperAdmin || userData.role === 'superadmin'
              };
              
              AuthStorage.setUser(userWithRole);
              setUser(userWithRole);
              setIsInitialized(true);
              setLoading(false);
              return;
            }
          } catch (refreshError) {
            console.error('Token refresh failed during init:', refreshError);
          }
        }
        
        // If refresh failed or no refresh token - clear session
        console.warn('Access token invalid and refresh failed. Clearing auth data for this tab.');
        sessionStorage.removeItem('authToken');
        sessionStorage.removeItem('refreshToken');
        AuthStorage.clear();
        setUser(null);
        setIsInitialized(true);
        setLoading(false);
        return;
      }
    } catch (err) {
      console.error('Auth initialization error:', err);
      setUser(null);
      sessionStorage.removeItem('authToken');
      AuthStorage.clear();
      setIsInitialized(true);
      setLoading(false);
    }
  };

  const clearError = () => setError(null);

  const login = async (emailOrUsername, password) => {
    try {
      setLoading(true);
      setError(null);

      const response = await API.post('/auth/login', {
        emailOrUsername,
        password
      });

      if (response.data.success) {
        const { accessToken, refreshToken, user: userData, isAdmin, isSuperAdmin, expiresIn } = response.data.data;
        // Store access token in sessionStorage (tab-isolated)
        sessionStorage.setItem('authToken', accessToken);
        sessionStorage.setItem('refreshToken', refreshToken);

        // Build user with role info
        const userWithRole = {
          ...userData,
          role: userData.role || 'user',
          isAdmin: isAdmin || userData.isAdmin || false,
          isSuperAdmin: isSuperAdmin || userData.isSuperAdmin || false
        };

        AuthStorage.setUser(userWithRole);
        setUser(userWithRole);
        setIsInitialized(true);

        console.log('  Login successful - Tab isolated session created', {
          userId: userData.id,
          role: userWithRole.role,
          tokenExpiry: `${expiresIn / 60} minutes`
        });

        return { 
          success: true, 
          user: userWithRole,
          isAdmin: userWithRole.isAdmin,
          isSuperAdmin: userWithRole.isSuperAdmin,
          redirectTo: userWithRole.isAdmin ? '/admin' : '/Dashboard'
        };
      }

      throw new Error(response.data.error?.message || 'Login failed');
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message || 'Login failed';
      setError(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  };

  const signup = async (formData) => {
    try {
      setLoading(true);
      setError(null);

      const response = await API.post('/auth/signup', {
        fullname: formData.fullname,
        username: formData.username,
        email: formData.email,
        password: formData.password,
        confirmPassword: formData.confirmPassword
      });

      if (response.data.success) {
        const { accessToken, refreshToken,  user: userData,  expiresIn } = response.data.data;
        
        // Store access token in sessionStorage (tab-isolated)
        sessionStorage.setItem('authToken', accessToken);
        sessionStorage.setItem('refreshToken', refreshToken);
        
        // New users are never admin
        const userWithRole = {
          ...userData,
          role: userData.role || 'user',
          isAdmin: false,
          isSuperAdmin: false
        };

        AuthStorage.setUser(userWithRole);
        setUser(userWithRole);
        setIsInitialized(true);
        
        console.log('  Signup successful - Tab isolated session created');
        
        return { success: true, user: userWithRole };
      } else {
        throw new Error(response.data.error?.message || 'Signup failed');
      }
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message || 'Signup failed';
      setError(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (credentials) => {
    const response = await API.post('/auth/login', credentials);

    if (response.data.success) {
      const { accessToken, refreshToken, user } = response.data.data;

      // Store tokens in sessionStorage for tab isolation
      sessionStorage.setItem('authToken', accessToken);
      sessionStorage.setItem('refreshToken', refreshToken);
      sessionStorage.setItem('user', JSON.stringify(user));

      setUser(user);
  }
};

  const processFirebaseUser = async (firebaseUser) => {
    try {
      // Get the Firebase ID token for secure server-side verification
      const idToken = await firebaseUser.getIdToken(true);
      
      const response = await API.post('/auth/firebase-login', {
        firebaseToken: idToken,
        email: firebaseUser.email,
        fullname: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL
      });

      if (response.data.success) {
        const { accessToken, refreshToken, user: userData, isAdmin, isSuperAdmin, expiresIn } = response.data.data;
      
        // Store access token in sessionStorage (tab-isolated)
        sessionStorage.setItem('authToken', accessToken);
        sessionStorage.setItem('refreshToken', refreshToken);
        
        // Build user with role info
        const userWithRole = {
          ...userData,
          role: userData.role || 'user',
          isAdmin: isAdmin || userData.isAdmin || false,
          isSuperAdmin: isSuperAdmin || userData.isSuperAdmin || false
        };

        AuthStorage.setUser(userWithRole);
        setUser(userWithRole);
        setIsInitialized(true);

        console.log('  Firebase login successful - Tab isolated session created');

        return { 
          success: true, 
          user: userWithRole,
          isAdmin: userWithRole.isAdmin,
          redirectTo: userWithRole.isAdmin ? '/admin' : '/Dashboard'
        };
      } else {
        throw new Error(response.data.error?.message || 'Firebase login failed');
      }
    } catch (err) {
      console.error('Process Firebase user error:', err);
      throw err;
    }
  };

  const loginWithGoogle = async () => {
    try {
      setError(null);
      setLoading(true);
      
    
      const firebaseUser = await signInWithGoogle();
      
      if (firebaseUser === null) {
        return { success: true };
      }

      const result = await processFirebaseUser(firebaseUser);
      
      return result;

    } catch (err) {
      console.error('Google login error:', err);
      const errorMessage = err.message || 'Google login failed';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      setLoading(true);

      if(user.provider === 'google' || user?.provider === 'firebase') {
        try {
          await signOutUser();
        } catch (firebaseErr) {
          console.error('Firebase signout skipped:', firebaseErr.message);
        }
      }

    try {
      await API.post('/auth/logout', {});
    } catch (logoutErr) {
      console.warn('Backend logout failed, proceeding with local cleanup:', logoutErr.message);
    }

    // Clear tab-specific token and user data
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('refreshToken');
    AuthStorage.clear();
    setUser(null);
    setError(null);
    
    console.log('  Logout successful - Tab session cleared');

    return { success: true };

  } catch (err) {
    console.error('Logout error:', err);
    return { success: false, error: err.message || 'Logout failed'};
  } finally {
    setLoading(false);
  }
};

  const refreshUserData = async () => {
    try {
      const response = await API.get('/user/profile');
      if (response.data.success) {
        const updatedUser = response.data.data.user;
        
        // Preserve role info
        const userWithRole = {
          ...user,
          ...updatedUser,
          role: updatedUser.role || user?.role || 'user',
          isAdmin: updatedUser.isAdmin || updatedUser.role === 'admin' || updatedUser.role === 'superadmin',
          isSuperAdmin: updatedUser.isSuperAdmin || updatedUser.role === 'superadmin'
        };

        updateUser(userWithRole);
        return userWithRole;
      }
    } catch (err) {
      console.error('Failed to refresh user data:', err);
      return null;
    }
  };

  const fetchUsageStats = async () => {
    try {
      const response = await API.get('/user/usage');
      if (response.data.success) {
        return response.data.data;
      }
    } catch (err) {
      console.error('Failed to fetch usage stats:', err);
      return null;
    }
  };

  const getTierConfig = (tier = user?.subscriptionTier) => {
    return TIER_CONFIG[tier] || TIER_CONFIG.free;
  };

  const hasTier = (requiredTier) => {
    const tierHierarchy = ['free', 'starter', 'pro'];
    const userTierIndex = tierHierarchy.indexOf(user?.subscriptionTier || 'free');
    const requiredTierIndex = tierHierarchy.indexOf(requiredTier);
    return userTierIndex >= requiredTierIndex;
  };

  const getUsagePercentage = (usageType) => {
    if (!user?.usage || !user?.limits) return 0;
    
    let usage = 0;
    let limit = 0;
    
    switch (usageType) {
      case 'uploads':
        usage = user.usage.uploadsThisMonth || 0;
        limit = user.limits.uploadsPerMonth;
        break;
      case 'storage':
        usage = user.usage.storageUsedMB || 0;
        limit = user.limits.maxStorageMB;
        break;
      case 'tokens':
        usage = user.usage.tokensUsedThisMonth || 0;
        limit = user.limits.tokensPerMonth;
        break;
      default:
        return 0;
    }
    
    if (limit === -1) return 0;
    if (limit === 0) return 100;
    
    return Math.min(Math.round((usage / limit) * 100), 100);
  };

  const hasReachedLimit = (limitType) => {
    if (!user?.usage || !user?.limits) return false;
    
    switch (limitType) {
      case 'uploads':
        if (user.limits.uploadsPerMonth === -1) return false;
        return user.usage.uploadsThisMonth >= user.limits.uploadsPerMonth;
      case 'storage':
        if (user.limits.maxStorageMB === -1) return false;
        return user.usage.storageUsedMB >= user.limits.maxStorageMB;
      case 'tokens':
        if (user.limits.tokensPerMonth === -1) return false;
        return user.usage.tokensUsedThisMonth >= user.limits.tokensPerMonth;
      default:
        return false;
    }
  };

  const getRemainingQuota = (quotaType) => {
    if (!user?.usage || !user?.limits) return 0;
    
    switch (quotaType) {
      case 'uploads':
        if (user.limits.uploadsPerMonth === -1) return 'unlimited';
        return Math.max(0, user.limits.uploadsPerMonth - user.usage.uploadsThisMonth);
      case 'storage':
        if (user.limits.maxStorageMB === -1) return 'unlimited';
        return Math.max(0, user.limits.maxStorageMB - user.usage.storageUsedMB);
      case 'tokens':
        if (user.limits.tokensPerMonth === -1) return 'unlimited';
        return Math.max(0, user.limits.tokensPerMonth - user.usage.tokensUsedThisMonth);
      default:
        return 0;
    }
  };

  const isSubscriptionExpired = () => {
    if (!user?.subscriptionExpiry) return false;
    return new Date() > new Date(user.subscriptionExpiry);
  };

  // Computed values for isAdmin
  const computedIsAdmin = user?.isAdmin || user?.role === 'admin' || user?.role === 'superadmin';
  const computedIsSuperAdmin = user?.isSuperAdmin || user?.role === 'superadmin';

  const value = {
    user,
    loading,
    error,
    isInitialized,
    isAuthenticated: !!user,
    login,
    signup,
    loginWithGoogle,
    logout,
    clearError,
    setUser,
    updateUser,
    refreshUserData,
    fetchUsageStats,
    
    // Role related - use computed values
    isAdmin: computedIsAdmin,
    isSuperAdmin: computedIsSuperAdmin,
    userRole: user?.role || 'user',
    
    // Tier related
    subscriptionTier: user?.subscriptionTier || 'free',
    subscriptionStatus: user?.subscriptionStatus || 'active',
    tierConfig: getTierConfig(),
    getTierConfig,
    hasTier,
    
    // Usage related
    usage: user?.usage || {},
    limits: user?.limits || {},
    getUsagePercentage,
    hasReachedLimit,
    getRemainingQuota,
    isSubscriptionExpired,
    
    // Tier booleans
    isFreeUser: user?.subscriptionTier === 'free',
    isStarterUser: user?.subscriptionTier === 'starter',
    isProUser: user?.subscriptionTier === 'pro'
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
