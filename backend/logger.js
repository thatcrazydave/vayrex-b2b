const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const errorLogPath = path.join(logsDir, 'error.log');
const accessLogPath = path.join(logsDir, 'access.log');

const getTimestamp = () => {
  return new Date().toISOString();
};

const REDACTED_KEYS = new Set([
  'password', 'confirmPassword', 'currentPassword', 'newPassword',
  'token', 'inviteToken', 'resetToken', 'accessToken', 'refreshToken',
  'originalBody',
  'resetCode', 'verificationCode', 'verificationToken',
]);

function redactSensitive(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitive);
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitive(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const formatLog = (level, message, data = null) => {
  const timestamp = getTimestamp();
  let logEntry = `[${timestamp}] [${level}] ${message}`;

  if (data) {
    logEntry += ` | ${JSON.stringify(redactSensitive(data))}`;
  }

  return logEntry;
};

const Logger = {
  error: (message, data = null) => {
    const logEntry = formatLog('ERROR', message, data);
    
    console.error(logEntry);
    
    try {
      fs.appendFile(errorLogPath, logEntry + '\n', (err) => {
        if (err) console.error('Failed to write to error log:', err.message);
      });
    } catch (err) {
      console.error('Failed to write to error log:', err.message);
    }
  },

  warn: (message, data = null) => {
    const logEntry = formatLog('WARN', message, data);
    console.warn(logEntry);
  },

  info: (message, data = null) => {
    const logEntry = formatLog('INFO', message, data);
    console.log(logEntry);
  },

  debug: (message, data = null) => {
    if (process.env.NODE_ENV !== 'production') {
      const logEntry = formatLog('DEBUG', message, data);
      console.log(logEntry);
    }
  },

  access: (method, path, statusCode, duration = 0) => {
    const logEntry = formatLog('ACCESS', `${method} ${path} ${statusCode} (${duration}ms)`);
    
    if (process.env.NODE_ENV !== 'production') {
      console.log(logEntry);
    }
    
    try {
      fs.appendFile(accessLogPath, logEntry + '\n', (err) => {
        if (err) console.error('Failed to write to access log:', err.message);
      });
    } catch (err) {
      console.error('Failed to write to access log:', err.message);
    }
  },

  apiError: (endpoint, statusCode, errorCode, message, details = null) => {
    const data = {
      endpoint,
      statusCode,
      errorCode,
      message,
      ...(details && { details })
    };
    Logger.error(`API Error: ${endpoint}`, data);
  },

  request: (method, url, clientIP) => {
    const data = { method, url, clientIP };
    Logger.debug('Incoming request', data);
  }
};

module.exports = Logger;