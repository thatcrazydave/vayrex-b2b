const Logger = require('../logger');

const requestValidator = (req, res, next) => {
  try {
    if (req.method === 'GET' || req.method === 'DELETE') {
      return next();
    }

    if (req.path.startsWith('/api/auth/')) {
      return next();
    }

    if (req.headers['content-type']?.includes('multipart/form-data')) {
      return next();
    }

    // Allow POST requests that don't require a body
    const bodyOptionalRoutes = [
      '/api/user/request-delete-otp',
      '/api/user/resend-verification',
      '/api/user/verify-email'
    ];
    
    if (bodyOptionalRoutes.some(route => req.path === route)) {
      return next();
    }

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      if (!req.body || Object.keys(req.body).length === 0) {
        Logger.warn('Empty request body', { 
          method: req.method, 
          path: req.path 
        });
        
        return res.status(400).json({
          success: false,
          error: {
            code: 'EMPTY_BODY',
            message: 'Request body cannot be empty',
            timestamp: new Date().toISOString()
          }
        });
      }
    }

    if (req.headers['content-type']?.includes('application/json')) {
      if (typeof req.body !== 'object' || Array.isArray(req.body)) {
        Logger.warn('Invalid JSON structure', { 
          method: req.method, 
          path: req.path 
        });
        
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_JSON_STRUCTURE',
            message: 'Request body must be a JSON object',
            timestamp: new Date().toISOString()
          }
        });
      }
    }

    next();
  } catch (err) {
    Logger.error('Request validation error', { 
      message: err.message,
      path: req.path 
    });
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        timestamp: new Date().toISOString()
      }
    });
  }
};

module.exports = { requestValidator };