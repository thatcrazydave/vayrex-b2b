const { Queue } = require('bullmq');
const Redis = require('ioredis');
const Logger = require('../logger');

const redisConfig = {
    maxRetriesPerRequest: null, // Critical for BullMQ
};

const redisConnection = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, redisConfig)
    : new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        ...redisConfig,
    });

redisConnection.on('connect', () => {
    Logger.info('BullMQ Redis connection established');
});

redisConnection.on('ready', () => {
    Logger.info('BullMQ Redis connection ready');
});

redisConnection.on('error', (err) => {
    Logger.error('BullMQ Redis Connection Error', { error: err.message });
});

const taskQueue = new Queue('background-tasks', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 10000, // 10s base delay for retries
        },
        removeOnComplete: true,
        removeOnFail: false,
    },
});

const USER_ACTIVE_JOB_TTL = 24 * 60 * 60;

const getUserActiveJobsKey = (userId) => `user:${userId}:active_jobs`;

async function getUserActiveJobs(userId) {
    const key = getUserActiveJobsKey(userId);
    const val = await redisConnection.get(key);
    return Number(val) || 0;
}

async function incrementUserActiveJobs(userId) {
    const key = getUserActiveJobsKey(userId);
    const count = await redisConnection.incr(key);
    await redisConnection.expire(key, USER_ACTIVE_JOB_TTL);
    return count;
}

async function decrementUserActiveJobs(userId) {
    const key = getUserActiveJobsKey(userId);
    const count = await redisConnection.decr(key);
    if (count < 0) {
        await redisConnection.set(key, '0', 'EX', USER_ACTIVE_JOB_TTL);
        return 0;
    }
    return count;
}

module.exports = {
    taskQueue,
    redisConnection,
    getUserActiveJobs,
    incrementUserActiveJobs,
    decrementUserActiveJobs,
};
