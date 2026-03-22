const redis = require('redis');
const Logger = require('./logger');

let redisClient = null;
let isConnected = false;  // Track connection state

const initializeRedis = async () => {
  try {
    // Prefer REDIS_URL if provided, otherwise fall back to host/port.
    const redisUrl = process.env.REDIS_URL;
    const redisPassword = process.env.REDIS_PASSWORD;

    const clientOptions = redisUrl
      ? {
          url: redisUrl,
          socket: {
            connectTimeout: 5000,
            reconnectStrategy: (retries) => {
              if (retries > 10) {
                Logger.error('Redis max retries reached');
                return new Error('Max retries reached');
              }
              return Math.min(retries * 100, 3000);
            }
          },
          password: redisPassword,
        }
      : {
          socket: {
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            connectTimeout: 5000,
            reconnectStrategy: (retries) => {
              if (retries > 10) {
                Logger.error('Redis max retries reached');
                return new Error('Max retries reached');
              }
              return Math.min(retries * 100, 3000);
            }
          },
          password: redisPassword,
        };

    redisClient = redis.createClient(clientOptions);

    redisClient.on('error', (err) => {
      isConnected = false;  // Mark as disconnected
      Logger.error('Redis Client Error', { error: err.message });
    });

    redisClient.on('connect', () => {
      isConnected = true;  // Mark as connected
      Logger.info('  Redis Client Connected');
    });

    redisClient.on('ready', () => {
      isConnected = true;
      Logger.info('  Redis Client Ready');
    });

    redisClient.on('reconnecting', () => {
      isConnected = false;  // Mark as reconnecting
      Logger.warn('  Redis Client Reconnecting');
    });

    redisClient.on('end', () => {
      isConnected = false;  // Mark as disconnected
      Logger.warn('  Redis Client Connection Ended');
    });

    await redisClient.connect();

    const pong = await redisClient.ping();
    Logger.info('Redis PING response:', { response: pong });
    Logger.info('  Redis Connected Successfully');

    isConnected = true;
    return redisClient;
  } catch (err) {
    isConnected = false;
    Logger.error('Redis initialization failed', { error: err.message });
    Logger.warn('  Server will continue without Redis (token revocation and rate limiting disabled)');
    // Don't throw - allow server to start without Redis
    return null;
  }
};

const getRedisClient = () => {
  if (!redisClient) {
    throw new Error('Redis client not initialized');
  }
  return redisClient;
};

// Check if Redis is ready
const isRedisReady = () => {
  return redisClient && isConnected && redisClient.isOpen;
};

const disconnectRedis = async () => {
  if (redisClient) {
    isConnected = false;
    await redisClient.quit();
    Logger.info('  Redis Disconnected');
  }
};

module.exports = {
  initializeRedis,
  getRedisClient,
  isRedisReady,  //  NEW
  disconnectRedis
};