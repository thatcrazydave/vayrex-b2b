const fs = require("fs");
const path = require("path");

const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const errorLogPath = path.join(logsDir, "error.log");
const accessLogPath = path.join(logsDir, "access.log");

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

// ── Logger API ─────────────────────────────────────────────────────────────
const Logger = {
  error: (message, data = null) => {
    const entry = formatLog("ERROR", message, data);
    console.error(entry);
    // Errors write immediately — no buffering risk on critical path
    fs.appendFile(errorLogPath, entry + "\n", (err) => {
      if (err) console.error("Failed to write to error log:", err.message);
    });
  },

  warn: (message, data = null) => {
    const entry = formatLog("WARN", message, data);
    if (!isProd) console.warn(entry);
    _errorBuf.push(entry);
    if (_errorBuf.length >= FLUSH_THRESHOLD) _flushBuffer(_errorBuf, errorLogPath);
  },

  info: (message, data = null) => {
    const entry = formatLog("INFO", message, data);
    if (!isProd) console.log(entry);
    _errorBuf.push(entry);
    if (_errorBuf.length >= FLUSH_THRESHOLD) _flushBuffer(_errorBuf, errorLogPath);
  },

  debug: (message, data = null) => {
    if (isProd) return;
    const entry = formatLog("DEBUG", message, data);
    console.log(entry);
    // Debug logs are dev-only and never written to disk
  },

  access: (method, urlPath, statusCode, duration = 0) => {
    const entry = formatLog("ACCESS", `${method} ${urlPath} ${statusCode} (${duration}ms)`);
    if (!isProd) console.log(entry);
    _accessBuf.push(entry);
    if (_accessBuf.length >= FLUSH_THRESHOLD) _flushBuffer(_accessBuf, accessLogPath);
  },

  apiError: (endpoint, statusCode, errorCode, message, details = null) => {
    const data = { endpoint, statusCode, errorCode, message, ...(details && { details }) };
    Logger.error(`API Error: ${endpoint}`, data);
  },

  request: (method, url, clientIP) => {
    Logger.debug("Incoming request", { method, url, clientIP });
  },
};

module.exports = Logger;
