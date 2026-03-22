// ===== Global Error Handling Middleware =====

const Logger = require('../logger');
const ErrorCodes = require('../errorCodes');


const sendErrorResponse = (res, statusCode, errorCode, publicMessage) => {
  return res.status(statusCode).json({
    success: false,
    data: null,
    error: {
      code: errorCode,
      message: publicMessage,
      timestamp: new Date().toISOString()
    }
  });
};

const errorHandler = (err, req, res, next) => {
  const timestamp = new Date().toISOString();
  const endpoint = `${req.method} ${req.path}`;
  
  // ===== MONGOOSE VALIDATION ERRORS =====
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors)
      .map(e => e.message)
      .join(', ');
    
    Logger.apiError(endpoint, 400, 'VALIDATION_ERROR', messages);
    
    return sendErrorResponse(
      res,
      400,
      'VALIDATION_ERROR',
      'Validation failed. Please check your input'
    );
  }

  // ===== MONGOOSE CAST ERRORS (Invalid ObjectId) =====
  if (err.name === 'CastError') {
    Logger.apiError(endpoint, 400, 'INVALID_ID', 'Invalid ID format');
    
    return sendErrorResponse(
      res,
      400,
      'INVALID_ID',
      'Invalid ID format'
    );
  }

  // ===== MONGOOSE DUPLICATE KEY ERRORS =====
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    
    Logger.apiError(endpoint, 409, 'DUPLICATE_ENTRY', `Duplicate ${field}`);
    
    return sendErrorResponse(
      res,
      409,
      'DUPLICATE_ENTRY',
      'This value already exists. Please use a different one.'
    );
  }

  // ===== JWT ERRORS =====
  if (err.name === 'JsonWebTokenError') {
    Logger.apiError(endpoint, 401, 'INVALID_TOKEN', 'JWT verification failed');
    
    return sendErrorResponse(
      res,
      401,
      'INVALID_TOKEN',
      'Your session has expired. Please log in again'
    );
  }

  if (err.name === 'TokenExpiredError') {
    Logger.apiError(endpoint, 401, 'TOKEN_EXPIRED', 'JWT token expired');
    
    return sendErrorResponse(
      res,
      401,
      'TOKEN_EXPIRED',
      'Your session has expired. Please log in again'
    );
  }

  // ===== CUSTOM APPLICATION ERRORS =====
  if (err.statusCode && err.code) {
    Logger.apiError(endpoint, err.statusCode, err.code, err.message);
    
    return sendErrorResponse(
      res,
      err.statusCode,
      err.code,
      err.publicMessage || err.message
    );
  }

  // ===== SYNTAX ERRORS (Malformed JSON) =====
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    Logger.apiError(endpoint, 400, 'INVALID_JSON', 'Malformed JSON');
    
    return sendErrorResponse(
      res,
      400,
      'INVALID_JSON',
      'Invalid request format'
    );
  }

  // ===== UNKNOWN ERRORS (Catch-all) =====
  Logger.error(`Unhandled error on ${endpoint}`, {
    name: err.name,
    message: err.message,
    stack: err.stack
  });

  // Return generic error to client (no technical details)
  return sendErrorResponse(
    res,
    500,
    'INTERNAL_ERROR',
    'Something went wrong. Please try again later'
  );
};

module.exports = errorHandler;