const cluster = require("cluster");
const os = require("os");
const Logger = require("./logger");

const WORKER_COUNT = parseInt(process.env.CLUSTER_WORKERS, 10) || os.cpus().length;
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60000; // 1 minute

if (cluster.isPrimary) {
  Logger.info(`Primary process ${process.pid} starting ${WORKER_COUNT} workers`);

  const workerDeaths = [];

  for (let i = 0; i < WORKER_COUNT; i++) {
    const env = { CLUSTER_MODE: "true" };
    if (i === 0) {
      env.BULLMQ_WORKER = "true";
    }
    cluster.fork(env);
  }

  cluster.on("exit", (worker, code, signal) => {
    Logger.error(`Worker ${worker.process.pid} died (code: ${code}, signal: ${signal})`);

    const now = Date.now();
    workerDeaths.push(now);

    while (workerDeaths.length > 0 && workerDeaths[0] < now - RESTART_WINDOW_MS) {
      workerDeaths.shift();
    }

    if (workerDeaths.length >= MAX_RESTARTS) {
      Logger.error(
        `${MAX_RESTARTS} worker deaths in ${RESTART_WINDOW_MS / 1000}s — stopping respawn to prevent death loop`,
      );
      return;
    }

    const wasBullMQWorker = worker.process.env && worker.process.env.BULLMQ_WORKER === "true";
    const env = { CLUSTER_MODE: "true" };
    if (wasBullMQWorker) env.BULLMQ_WORKER = "true";

    Logger.info("Forking replacement worker...");
    cluster.fork(env);
  });

  process.on("SIGTERM", () => {
    Logger.info("Primary received SIGTERM — shutting down all workers");
    for (const id in cluster.workers) {
      cluster.workers[id].process.kill("SIGTERM");
    }
  });
} else {
  require("./server");
}
