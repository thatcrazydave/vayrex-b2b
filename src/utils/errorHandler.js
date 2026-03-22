/**
 * Standardized Error Handling Utility
 * Ensures consistent error display and prevents infinite loaders
 */

// Error types that should stop execution
export const CRITICAL_ERRORS = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  SERVER_DOWN: 'SERVER_DOWN',
  RATE_LIMITED: 'RATE_LIMITED',
  AUTH_ERROR: 'AUTH_ERROR',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  PERMISSION_DENIED: 'PERMISSION_DENIED'
};

/**
 * Extract meaningful error message from API error response
 */
export function getErrorMessage(error) {
  // Network errors (server down, no internet)
  if (!error.response) {
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return {
        type: CRITICAL_ERRORS.NETWORK_ERROR,
        message: 'Request timed out. The server is taking too long to respond.',
        shouldRetry: true
      };
    }
    if (error.message === 'Network Error' || error.message?.includes('Failed to fetch')) {
      return {
        type: CRITICAL_ERRORS.SERVER_DOWN,
        message: 'Unable to connect to server. Please check your internet connection or try again later.',
        shouldRetry: false
      };
    }
    return {
      type: CRITICAL_ERRORS.NETWORK_ERROR,
      message: 'Network error occurred. Please check your connection.',
      shouldRetry: true
    };
  }

  const status = error.response.status;
  const data = error.response.data;
  const errorCode = data?.error?.code || data?.code;
  const errorMessage = data?.error?.message || data?.message;

  // ── Specific error codes take priority over status codes ──

  // Plan/token limits (403)
  if (errorCode === 'TOKEN_LIMIT_REACHED' || errorCode === 'TOKEN_REQUEST_LIMIT') {
    return {
      type: 'PLAN_LIMIT',
      message: errorMessage || 'You have reached your plan\'s usage limit. Consider upgrading.',
      shouldRetry: false
    };
  }

  if (errorCode === 'UPLOAD_LIMIT_REACHED' || errorCode === 'STORAGE_LIMIT_REACHED') {
    return {
      type: 'PLAN_LIMIT',
      message: errorMessage || 'Upload or storage limit reached. Consider upgrading.',
      shouldRetry: false
    };
  }

  // Queue/capacity limits (503)
  if (errorCode === 'USER_JOB_LIMIT') {
    return {
      type: 'QUEUE_BUSY',
      message: errorMessage || 'You have too many jobs queued. Please wait for one to finish.',
      shouldRetry: true
    };
  }

  if (errorCode === 'QUEUE_OVERLOADED' || errorCode === 'QUEUE_ERROR') {
    return {
      type: 'QUEUE_BUSY',
      message: errorMessage || 'The system is busy. Your request will be processed shortly.',
      shouldRetry: true
    };
  }

  // Rate limiting (only actual 429s)
  if (status === 429 || errorCode === 'RATE_LIMIT_EXCEEDED' || errorCode === 'RATE_LIMIT_BLOCKED') {
    return {
      type: CRITICAL_ERRORS.RATE_LIMITED,
      message: errorMessage || 'Rate limit reached. Please wait a moment before trying again.',
      retryAfter: data?.error?.retryAfter || data?.retryAfter || 60,
      shouldRetry: false
    };
  }

  // Authentication errors
  if (status === 401) {
    return {
      type: CRITICAL_ERRORS.AUTH_ERROR,
      message: errorMessage || 'Your session has expired. Please log in again.',
      shouldRetry: false,
      requiresLogin: true
    };
  }

  // Account locked/suspended
  if (errorCode === 'ACCOUNT_LOCKED' || errorCode === 'ACCOUNT_SUSPENDED') {
    return {
      type: CRITICAL_ERRORS.ACCOUNT_LOCKED,
      message: errorMessage || 'Your account has been locked. Please contact support.',
      shouldRetry: false
    };
  }

  // Permission denied (403 that isn't CSRF or plan limit)
  if (status === 403 && errorCode !== 'INVALID_CSRF_TOKEN') {
    return {
      type: CRITICAL_ERRORS.PERMISSION_DENIED,
      message: errorMessage || 'You do not have permission to perform this action.',
      shouldRetry: false
    };
  }

  // Validation errors (4xx)
  if (status >= 400 && status < 500) {
    return {
      type: 'VALIDATION_ERROR',
      message: errorMessage || 'Invalid request. Please check your input.',
      shouldRetry: false
    };
  }

  // Server errors (5xx)
  if (status >= 500) {
    return {
      type: 'SERVER_ERROR',
      message: errorMessage || 'Server error occurred. Please try again later.',
      shouldRetry: true
    };
  }

  // Default error
  return {
    type: 'UNKNOWN_ERROR',
    message: errorMessage || 'An unexpected error occurred. Please try again.',
    shouldRetry: true
  };
}

/**
 * Handle API errors consistently
 * - Stops loading states
 * - Shows appropriate error message
 * - Redirects if necessary (auth errors)
 * 
 * @param {Error} error - The error object from API call
 * @param {Function} setLoading - Function to set loading state to false
 * @param {Function} setError - Function to set error message
 * @param {Function} [navigate] - Navigation function for redirects
 * @param {Object} [options] - Additional options
 * @returns {Object} - Error details
 */
export function handleApiError(error, setLoading, setError, navigate = null, options = {}) {
  // Always stop loading
  if (setLoading) {
    setLoading(false);
  }

  const errorDetails = getErrorMessage(error);
  
  // Set error message
  if (setError) {
    setError(errorDetails.message);
  }

  // Log error for debugging
  console.error('[API Error]', {
    type: errorDetails.type,
    message: errorDetails.message,
    status: error.response?.status,
    code: error.response?.data?.error?.code,
    endpoint: error.config?.url
  });

  // Handle authentication errors
  if (errorDetails.requiresLogin && navigate && !options.skipRedirect) {
    sessionStorage.clear();
    setTimeout(() => {
      navigate('/login', { 
        state: { message: 'Your session has expired. Please log in again.' } 
      });
    }, 2000);
  }

  return errorDetails;
}

/**
 * Enhanced API call wrapper with automatic error handling
 * Ensures loaders never get stuck and errors are always displayed
 * 
 * @param {Function} apiCall - The API call function to execute
 * @param {Object} handlers - Object containing { setLoading, setError, navigate }
 * @param {Object} options - Additional options
 * @returns {Promise} - The API call result
 */
export async function safeApiCall(apiCall, handlers, options = {}) {
  const { setLoading, setError, navigate } = handlers;
  
  try {
    if (setLoading) setLoading(true);
    if (setError) setError(null);
    
    const result = await apiCall();
    
    if (setLoading) setLoading(false);
    return result;
    
  } catch (error) {
    handleApiError(error, setLoading, setError, navigate, options);
    throw error; // Re-throw so caller can handle if needed
  }
}

/**
 * Create error display banner component data
 */
export function createErrorBanner(errorDetails) {
  const icons = {
    [CRITICAL_ERRORS.NETWORK_ERROR]: '🌐',
    [CRITICAL_ERRORS.SERVER_DOWN]: '⚠️',
    [CRITICAL_ERRORS.RATE_LIMITED]: '⏱️',
    [CRITICAL_ERRORS.AUTH_ERROR]: '🔒',
    [CRITICAL_ERRORS.ACCOUNT_LOCKED]: '🚫',
    [CRITICAL_ERRORS.PERMISSION_DENIED]: '⛔',
  };

  const colors = {
    [CRITICAL_ERRORS.NETWORK_ERROR]: '#f59e0b',
    [CRITICAL_ERRORS.SERVER_DOWN]: '#ef4444',
    [CRITICAL_ERRORS.RATE_LIMITED]: '#f59e0b',
    [CRITICAL_ERRORS.AUTH_ERROR]: '#ef4444',
    [CRITICAL_ERRORS.ACCOUNT_LOCKED]: '#dc2626',
    [CRITICAL_ERRORS.PERMISSION_DENIED]: '#dc2626',
  };

  return {
    icon: icons[errorDetails.type] || '⚠️',
    color: colors[errorDetails.type] || '#ef4444',
    message: errorDetails.message,
    canRetry: errorDetails.shouldRetry,
    retryAfter: errorDetails.retryAfter
  };
}
