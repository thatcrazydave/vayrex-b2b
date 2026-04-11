const { Worker } = require("bullmq");
const { redisConnection } = require("../services/taskQueue");
const { archiveTerm } = require("../services/termArchiveService");
const Logger = require("../logger");

const termArchiveWorker = new Worker(
  "term-archive",
  async (job) => {
    const { orgId, termId, userId, overrideReason } = job.data;
    Logger.info(`Term archive worker processing job ${job.id}`, { orgId, termId });

    const result = await archiveTerm({ orgId, termId, userId, overrideReason });

    Logger.info(`Term archive worker completed job ${job.id}`, { orgId, termId, result });
    return result;
  },
  {
    connection: redisConnection,
    concurrency: 1,
    limiter: { max: 2, duration: 60000 },
  },
);

termArchiveWorker.on("completed", (job, result) => {
  Logger.info(`Term archive job ${job.id} completed`, result);
});

termArchiveWorker.on("failed", (job, err) => {
  Logger.error(`Term archive job ${job.id} failed`, { error: err.message });
});

module.exports = { termArchiveWorker };
