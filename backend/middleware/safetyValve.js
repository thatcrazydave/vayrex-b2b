const { monitorEventLoopDelay } = require("perf_hooks");
const Logger = require("../logger");

const LAG_THRESHOLD_MS = 100;
const MAX_SHED_PERCENT = 0.05; // Never shed more than 5%
const SAMPLE_INTERVAL_MS = 20;

const EXEMPT_PATHS = ["/api/auth/refresh", "/api/auth/verify", "/api/auth/login"];

const histogram = monitorEventLoopDelay({ resolution: SAMPLE_INTERVAL_MS });
histogram.enable();

let currentLagMs = 0;

setInterval(() => {
  currentLagMs = histogram.percentile(99) / 1e6;
  histogram.reset();
}, 2000);

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function safetyValve(req, res, next) {
  if (currentLagMs <= LAG_THRESHOLD_MS) return next();

  if (EXEMPT_PATHS.some((p) => req.path.startsWith(p))) return next();

  const shedPercent = Math.min(
    (currentLagMs - LAG_THRESHOLD_MS) / (LAG_THRESHOLD_MS * 2),
    MAX_SHED_PERCENT,
  );

  const ipHash = hashCode(req.ip || "unknown") % 100;
  if (ipHash < shedPercent * 100) {
    Logger.warn("Safety valve: shedding request due to event loop lag", {
      lagMs: Math.round(currentLagMs),
      shedPercent: (shedPercent * 100).toFixed(1) + "%",
      ip: req.ip,
      path: req.path,
    });

    return res
      .status(503)
      .set("Retry-After", "5")
      .json({
        success: false,
        error: {
          code: "SERVICE_BUSY",
          message: "The system is experiencing high load. Please retry in a few seconds.",
          retryAfter: 5,
        },
      });
  }

  next();
}

function getCurrentLag() {
  return currentLagMs;
}

module.exports = { safetyValve, getCurrentLag };
