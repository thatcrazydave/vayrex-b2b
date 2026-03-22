// CREATE THIS FILE:

const Logger = {
  info: (message, data = {}) => {
    console.log(`[INFO] ${message}`, data);
  },
  warn: (message, data = {}) => {
    console.warn(`[WARN] ${message}`, data);
  },
  error: (message, data = {}) => {
    console.error(`[ERROR] ${message}`, data);
  },
  debug: (message, data = {}) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[DEBUG] ${message}`, data);
    }
  }
};

export default Logger;