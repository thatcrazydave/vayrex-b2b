const AuditLog = require('../models/AuditLog');
const Logger = require('../logger');

function auditLogger(action, targetType = null) {
  return async (req, res, next) => {
    const originalJson = res.json;
    
    res.json = function(data) {
      // Only log if operation was successful
      if (data.success !== false) {
        AuditLog.create({
          userId: req.user?.id,
          action,
          targetType,
          targetId: req.params.id || data.data?.id || null,
          details: {
            endpoint: req.path,
            method: req.method,
            body: sanitizeBody(req.body),
            response: sanitizeResponse(data)
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          severity: determineSeverity(action)
        }).catch(err => {
          Logger.error('Audit log creation error', { error: err.message });
        });
      }
      
      originalJson.call(this, data);
    };
    
    next();
  };
}

const SENSITIVE_FIELDS = [
  'password', 'confirmPassword', 'currentPassword', 'newPassword',
  'token', 'inviteToken', 'resetToken', 'verificationToken',
  'resetCode', 'verificationCode', 'accessToken', 'refreshToken',
];

function sanitizeBody(body) {
  return deepSanitize(body);
}

function sanitizeResponse(data) {
  return deepSanitize(data);
}

function deepSanitize(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(deepSanitize);
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.includes(key)) continue;
    sanitized[key] = typeof value === 'object' && value !== null ? deepSanitize(value) : value;
  }
  return sanitized;
}

function determineSeverity(action) {
  const criticalActions = ['user_deleted', 'user_role_changed', 'backup_restored'];
  const warningActions = ['user_status_changed', 'failed_login'];
  
  if (criticalActions.includes(action)) return 'critical';
  if (warningActions.includes(action)) return 'warning';
  return 'info';
}

module.exports = auditLogger;