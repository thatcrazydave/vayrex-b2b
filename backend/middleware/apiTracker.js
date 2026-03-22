const ApiUsage = require('../models/ApiUsage');
const Logger = require('../logger');

function apiTracker(req, res, next) {
  const startTime = Date.now();
  
  const originalSend = res.send;
  
  res.send = function(data) {
    const responseTime = Date.now() - startTime;
    
    // Log API usage (async, non-blocking)
    ApiUsage.create({
      endpoint: req.path,
      method: req.method,
      userId: req.user?.id || null,
      statusCode: res.statusCode,
      responseTime,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    }).catch(err => {
      Logger.error('API tracking error', { error: err.message });
    });
    
    // Check for slow responses
    if (responseTime > 5000) {
      Logger.warn('Slow API response', {
        endpoint: req.path,
        method: req.method,
        responseTime,
        userId: req.user?.id
      });
    }
    
    originalSend.call(this, data);
  };
  
  next();
}

module.exports = apiTracker;