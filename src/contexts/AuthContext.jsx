import React, { createContext, useContext, useState, useEffect } from 'react';
import API, { refreshCsrfToken } from '../services/api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// ── Token storage strategy ──────────────────────────────────────────────────
// Goal: survive page refresh WITHOUT losing tab isolation.
//
//  localStorage   → persists across refresh (same browser, all tabs)
//  sessionStorage → tab-specific override; wins over localStorage
//
// On login  → write to BOTH (so refresh restores session)
// On init   → copy localStorage → sessionStorage if sessionStorage is empty
//             (the "restore on refresh" step)
// On logout → clear BOTH
//
// Tab isolation: a new login in a tab writes sessionStorage which overrides
// localStorage for that tab. Other tabs are unaffected until their next
// sessionStorage read (or refresh).
// ─────────────────────────────────────────────────────────────────────────────

const TokenStore = {
  getToken: (key) =>
    sessionStorage.getItem(key) || localStorage.getItem(key) || null,

  setToken: (key, value) => {
    sessionStorage.setItem(key, value);
    localStorage.setItem(key, value);
  },

  removeToken: (key) => {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  },

  // On page load: copy localStorage values into sessionStorage so the rest
  // of the code (which only reads sessionStorage) can find them.
  restoreIntoSession: () => {
    ['authToken', 'refreshToken'].forEach(key => {
      if (!sessionStorage.getItem(key)) {
        const persisted = localStorage.getItem(key);
        if (persisted) sessionStorage.setItem(key, persisted);
      }
    });
  },
};

const AuthStorage = {
  getUser: () => {
    try {
      const raw = sessionStorage.getItem('user') || localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  setUser: (user) => {
    const json = JSON.stringify(user);
    sessionStorage.setItem('user', json);
    localStorage.setItem('user', json);
  },
  clear: () => {
    sessionStorage.removeItem('user');
    localStorage.removeItem('user');
  },
  restoreIntoSession: () => {
    if (!sessionStorage.getItem('user')) {
      const persisted = localStorage.getItem('user');
      if (persisted) sessionStorage.setItem('user', persisted);
    }
  },
};

// Tier configuration for display purposes
const TIER_CONFIG = {
  school_starter: {
    name: 'School Starter',
    color: '#3b82f6',
    badge: 'Starter'
  },
  school_pro: {
    name: 'School Pro',
    color: '#8b5cf6',
    badge: 'Pro'
  },
  enterprise: {
    name: 'Enterprise',
    color: '#10b981',
    badge: 'Enterprise'
  }
};

// ── Role-based redirect helper (B2B org-scoped) ────────────────────────────
const ROLE_REDIRECTS = {
  owner: '/org-admin',
  org_admin: '/org-admin',
  it_admin: '/org-admin',
  teacher: '/teacher',
  student: '/student',
  guardian: '/guardian-portal',
};

function getDashboardRoute(userData) {
  if (!userData) return null;
  if (userData.isAdmin || userData.isSuperAdmin || userData.role === 'admin' || userData.role === 'superadmin') {
    return '/admin';
  }
  if (userData.orgRole && ROLE_REDIRECTS[userData.orgRole]) {
    return ROLE_REDIRECTS[userData.orgRole];
  }
  // Org owner who just signed up but hasn't completed setup → wizard
  if (userData.organizationId && !userData.orgRole) {
    return '/org-setup';
  }
  return null;
}

export { getDashboardRoute };

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
          TokenStore.removeToken('authToken');
          TokenStore.removeToken('refreshToken');
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

  const initializeAuth = async () => {
    try {
      setLoading(true);

      // Step 1: Restore persisted tokens into sessionStorage.
      // sessionStorage is wiped on every page refresh.
      // Copy from localStorage so the API interceptor can find tokens.
      TokenStore.restoreIntoSession();
      AuthStorage.restoreIntoSession();

      // Step 2: Read tokens
      const accessToken  = sessionStorage.getItem('authToken') || sessionStorage.getItem('accessToken');
      const refreshToken = sessionStorage.getItem('refreshToken');

      // Normalize legacy key
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
            TokenStore.setToken('authToken', newToken);

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
          setUser(null);
          AuthStorage.clear();
          TokenStore.removeToken('authToken');
          TokenStore.removeToken('refreshToken');
          setIsInitialized(true);
          setLoading(false);
          return;
        }
      }

      try {
        const response = await API.get('/auth/verify');

        if (response.data.success) {
          const verifiedUser = response.data.data?.user;
          const isAdmin      = response.data.data?.isAdmin;
          const isSuperAdmin = response.data.data?.isSuperAdmin;

          const finalUser = {
            ...verifiedUser,
            role:         verifiedUser?.role || 'user',
            isAdmin:      isAdmin      || verifiedUser?.isAdmin      || verifiedUser?.role === 'admin' || verifiedUser?.role === 'superadmin',
            isSuperAdmin: isSuperAdmin || verifiedUser?.isSuperAdmin || verifiedUser?.role === 'superadmin'
          };

          AuthStorage.setUser(finalUser);
          setUser(finalUser);
          setIsInitialized(true);
          setLoading(false);
          return;
        } else {
          throw new Error('Token verification returned success:false');
        }
      } catch (verifyError) {
        const storedRefreshToken = sessionStorage.getItem('refreshToken');

        if (storedRefreshToken) {
          try {
            const refreshResponse = await API.post('/auth/refresh', { refreshToken: storedRefreshToken });

            if (refreshResponse.data.success) {
              const { accessToken: newToken, refreshToken: newRefreshToken, user: userData } = refreshResponse.data.data;

              TokenStore.setToken('authToken', newToken);
              TokenStore.setToken('refreshToken', newRefreshToken);

              const userWithRole = {
                ...userData,
                role:         userData.role || 'user',
                isAdmin:      userData.isAdmin      || userData.role === 'admin' || userData.role === 'superadmin',
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

        console.warn('Access token invalid and refresh failed. Clearing auth data for this tab.');
        TokenStore.removeToken('authToken');
        TokenStore.removeToken('refreshToken');
        AuthStorage.clear();
        setUser(null);
        setIsInitialized(true);
        setLoading(false);
        return;
      }
    } catch (err) {
      console.error('Auth initialization error:', err);
      setUser(null);
      TokenStore.removeToken('authToken');
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
        // Store tokens in BOTH storages (persist across refresh, isolate per tab)
        TokenStore.setToken('authToken', accessToken);
        TokenStore.setToken('refreshToken', refreshToken);

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
          redirectTo: getDashboardRoute(userWithRole)
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
        confirmPassword: formData.confirmPassword,
        ...(formData.inviteToken && { inviteToken: formData.inviteToken }),
      });

      if (response.data.success) {
        // Account created but awaiting approval — no tokens issued
        if (response.data.pending) {
          return {
            success: false,
            pending: true,
            error: response.data.message || 'Your account is pending review.',
          };
        }

        const { accessToken, refreshToken,  user: userData,  expiresIn } = response.data.data;

        // Store tokens in BOTH storages
        TokenStore.setToken('authToken', accessToken);
        TokenStore.setToken('refreshToken', refreshToken);

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

        return { success: true, user: userWithRole };
      } else {
        throw new Error(response.data.error?.message || 'Signup failed');
      }
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message || 'Signup failed';
      const code = err.response?.data?.error?.code || null;
      const hint = err.response?.data?.error?.hint || null;
      setError(message);
      return { success: false, error: message, code, hint };
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (credentials) => {
    const response = await API.post('/auth/login', credentials);

    if (response.data.success) {
      const { accessToken, refreshToken, user } = response.data.data;

      // Store tokens in BOTH storages
      TokenStore.setToken('authToken', accessToken);
      TokenStore.setToken('refreshToken', refreshToken);
      sessionStorage.setItem('user', JSON.stringify(user));

      setUser(user);
  }
};

  const logout = async () => {
    try {
      setLoading(true);

    try {
      await API.post('/auth/logout', {});
    } catch (logoutErr) {
      console.warn('Backend logout failed, proceeding with local cleanup:', logoutErr.message);
    }

    // Clear tokens from BOTH storages
    TokenStore.removeToken('authToken');
    TokenStore.removeToken('refreshToken');
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
    return TIER_CONFIG[tier] || null;
  };

  const hasTier = (requiredTier) => {
    const tierHierarchy = ['school_starter', 'school_pro', 'enterprise'];
    const userTierIndex = tierHierarchy.indexOf(user?.subscriptionTier || 'school_starter');
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
