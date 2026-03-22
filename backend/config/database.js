const mongoose = require('mongoose');
const Logger = require('../logger');

// ===== STATE =====
let mongoConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 5000;

async function connectDatabase(mongoUri) {
  if (!mongoUri) {
    throw new Error('MONGODB_URI not provided');
  }

  try {
    await mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4 // Use IPv4
    });

    mongoConnected = true;
    reconnectAttempts = 0;
    Logger.info(' MongoDB connected successfully');
    
    return true;
  } catch (err) {
    Logger.error('  MongoDB connection failed', {
      error: err.message,
      uri: mongoUri.replace(/\/\/([^:]+):([^@]+)/, '//***:***')
    });
    throw err;
  }
}

/**
 * Setup MongoDB event handlers
 */
function setupEventHandlers() {
  mongoose.connection.on('connected', () => {
    mongoConnected = true;
    reconnectAttempts = 0;
    Logger.info(' MongoDB connected');
  });

  mongoose.connection.on('reconnected', () => {
    mongoConnected = true;
    reconnectAttempts = 0;
    Logger.info('🔄 MongoDB reconnected');
  });

  mongoose.connection.on('disconnected', () => {
    mongoConnected = false;
    Logger.error('  MongoDB disconnected');

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = RECONNECT_DELAY_MS * reconnectAttempts;

      Logger.info(`⏳ Reconnecting in ${delay}ms (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

      setTimeout(async () => {
        try {
          await mongoose.connect(process.env.MONGODB_URI, {
            maxPoolSize: 10,
            minPoolSize: 2,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4
          });
          mongoConnected = true;
          reconnectAttempts = 0;
          Logger.info(' Reconnected to MongoDB');
        } catch (err) {
          Logger.error('  Reconnection failed', { error: err.message });
          
          if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            Logger.error('  Max reconnection attempts reached. Entering degraded mode.');
            // Enter degraded mode - continue retrying in background instead of exiting
            reconnectAttempts = Math.floor(MAX_RECONNECT_ATTEMPTS / 2); // Reset to half to continue trying
          }
        }
      }, delay);
    } else {
      Logger.error('  Max reconnection attempts reached. Entering degraded mode.');
      // Enter degraded mode - schedule periodic reconnection attempts
      reconnectAttempts = Math.floor(MAX_RECONNECT_ATTEMPTS / 2);
    }
  });

  mongoose.connection.on('error', (err) => {
    mongoConnected = false;
    Logger.error('  MongoDB error', {
      error: err.message,
      code: err.code
    });
  });
}

/**
 * Check if MongoDB is connected
 */
function isConnected() {
  return mongoConnected && mongoose.connection.readyState === 1;
}

/**
 * Get MongoDB connection status
 */
function getStatus() {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  return {
    connected: mongoConnected,
    readyState: mongoose.connection.readyState,
    state: states[mongoose.connection.readyState],
    reconnectAttempts,
    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS
  };
}

/**
 * Gracefully disconnect from MongoDB
 */
async function disconnect() {
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      Logger.info(' MongoDB disconnected gracefully');
    }
  } catch (err) {
    Logger.error('Error disconnecting MongoDB', { error: err.message });
  }
}

module.exports = {
  connectDatabase,
  setupEventHandlers,
  isConnected,
  getStatus,
  disconnect
};