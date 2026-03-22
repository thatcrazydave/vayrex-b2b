const { isConnected } = require('../config/database');
const Logger = require('../logger');

/**
 * Middleware to check database health before processing requests
 */
function checkDatabaseHealth(req, res, next) {
  if (!isConnected()) {
    Logger.warn('Request blocked - database unavailable', {
      method: req.method,
      path: req.path,
      ip: req.ip
    });

    return res.status(503).json({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database is temporarily unavailable. Please try again in a few moments.',
        timestamp: new Date().toISOString(),
        retryAfter: 30 // seconds
      }
    });
  }

  next();
}

module.exports = { checkDatabaseHealth };