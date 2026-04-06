const cron = require("node-cron");
const reportService = require("./services/reportService");
const AlertService = require("./services/alertService");
const Logger = require("./logger");

// Run every Monday at 9:00 AM
cron.schedule("0 9 * * 1", async () => {
  try {
    Logger.info("Starting scheduled weekly report generation");
    await reportService.scheduleWeeklyReports();
  } catch (err) {
    Logger.error("Scheduled weekly report failed", { error: err.message });
    await AlertService.createAlert({
      severity: "medium",
      type: "scheduled_task_failed",
      service: "scheduler",
      message: "Weekly report generation failed",
      details: { error: err.message },
    });
  }
});

// Check system health every 5 minutes
// Guard prevents a slow/hung check from stacking with the next scheduled run
let _healthCheckRunning = false;
cron.schedule("*/5 * * * *", async () => {
  if (_healthCheckRunning) {
    Logger.warn("Health check skipped — previous run still active");
    return;
  }
  _healthCheckRunning = true;
  try {
    const health = await AlertService.checkSystemHealth();
    const unhealthyServices = Object.entries(health)
      .filter(([_, isHealthy]) => !isHealthy)
      .map(([service]) => service);

    if (unhealthyServices.length > 0) {
      await AlertService.createAlert({
        severity: "high",
        type: "service_down",
        service: unhealthyServices.join(", "),
        message: `Services unhealthy: ${unhealthyServices.join(", ")}`,
        details: health,
      });
    }
  } catch (err) {
    Logger.error("Health check failed", { error: err.message });
  } finally {
    _healthCheckRunning = false;
  }
});

// Clean up old logs every day at 2:00 AM
cron.schedule("0 2 * * *", async () => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const ApiUsage = require("./models/ApiUsage");
    const result = await ApiUsage.deleteMany({
      timestamp: { $lt: thirtyDaysAgo },
    });

    Logger.info("Old API usage logs cleaned", { deletedCount: result.deletedCount });
  } catch (err) {
    Logger.error("Log cleanup failed", { error: err.message });
  }
});

// Check expired subscriptions daily at 3:00 AM
cron.schedule("0 3 * * *", async () => {
  try {
    const User = require("./models/User");
    const now = new Date();

    // Migrate any legacy business/enterprise users to pro
    const legacyUsers = await User.find({
      subscriptionTier: { $in: ["business", "enterprise"] },
    });
    if (legacyUsers.length > 0) {
      const proLimits = await User.getLiveTierLimits("pro");
      await User.bulkWrite(
        legacyUsers.map((u) => ({
          updateOne: {
            filter: { _id: u._id },
            update: { $set: { subscriptionTier: "pro", limits: { ...proLimits } } },
          },
        })),
      );
      Logger.info("Legacy tier users migrated to pro", { count: legacyUsers.length });
    }

    // Find users with expired subscriptions
    const expiredUsers = await User.find({
      subscriptionTier: { $ne: "free" },
      subscriptionStatus: { $in: ["active", "past_due"] },
      subscriptionExpiry: { $lt: now },
    });

    const freeLimits = await User.getLiveTierLimits("free");
    const downgraded = expiredUsers.length;
    if (downgraded > 0) {
      await User.bulkWrite(
        expiredUsers.map((u) => ({
          updateOne: {
            filter: { _id: u._id },
            update: {
              $set: {
                subscriptionTier: "free",
                subscriptionStatus: "expired",
                limits: { ...freeLimits },
                paystackSubscriptionCode: null,
                paystackAuthorizationCode: null,
              },
            },
          },
        })),
      );
    }

    if (downgraded > 0) {
      Logger.info("Expired subscriptions downgraded", { count: downgraded });
      await AlertService.createAlert({
        severity: "low",
        type: "subscriptions_expired",
        service: "scheduler",
        message: `${downgraded} subscription(s) expired and downgraded to free`,
        details: { count: downgraded },
      });
    }
  } catch (err) {
    Logger.error("Subscription expiry check failed", { error: err.message });
  }
});

// Reset daily upload counts at midnight UTC every day
cron.schedule("0 0 * * *", async () => {
  try {
    const User = require("./models/User");
    const result = await User.updateMany(
      {},
      {
        $set: {
          "usage.uploadsToday": 0,
          "usage.lastDailyReset": new Date(),
        },
      },
    );
    Logger.info("Daily upload counts reset", { modifiedCount: result.modifiedCount });
  } catch (err) {
    Logger.error("Daily upload reset failed", { error: err.message });
  }
});

// Reset monthly usage on the 1st of each month at 00:05 AM
cron.schedule("5 0 1 * *", async () => {
  try {
    const User = require("./models/User");
    const result = await User.updateMany(
      {},
      {
        $set: {
          "usage.uploadsThisMonth": 0,
          "usage.tokensUsedThisMonth": 0,
          "usage.lastResetDate": new Date(),
        },
      },
    );
    Logger.info("Monthly usage reset", { modifiedCount: result.modifiedCount });
  } catch (err) {
    Logger.error("Monthly usage reset failed", { error: err.message });
  }
});

// Clean up failed/stale jobs every hour
cron.schedule("0 * * * *", async () => {
  try {
    const { taskQueue, redisConnection } = require("./services/taskQueue");

    // Remove failed jobs older than 2 hours
    const failedRemoved = await taskQueue.clean(2 * 60 * 60 * 1000, 100, "failed");
    // Remove completed jobs older than 1 hour (safety net if removeOnComplete missed any)
    const completedRemoved = await taskQueue.clean(60 * 60 * 1000, 100, "completed");

    // Fix stale user active_jobs counters by reconciling with actual queue state
    const activeJobs = await taskQueue.getJobs(["active", "waiting", "delayed"]);
    const userJobCounts = {};
    for (const job of activeJobs) {
      const userId = job.data?.userId;
      if (userId) {
        userJobCounts[userId] = (userJobCounts[userId] || 0) + 1;
      }
    }

    // Scan for user active_jobs keys and correct any that are out of sync
    // Collect all keys first via SCAN, then batch-read and batch-write
    const allTrackedKeys = [];
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redisConnection.scan(
        cursor,
        "MATCH",
        "user:*:active_jobs",
        "COUNT",
        100,
      );
      cursor = nextCursor;
      allTrackedKeys.push(...keys);
    } while (cursor !== "0");

    if (allTrackedKeys.length > 0) {
      // Batch-read all stored counts in parallel
      const storedValues = await Promise.all(
        allTrackedKeys.map((k) => redisConnection.get(k)),
      );

      // Identify mismatches and build correction commands
      const corrections = [];
      for (let idx = 0; idx < allTrackedKeys.length; idx++) {
        const key = allTrackedKeys[idx];
        const userId = key.split(":")[1];
        const storedCount = Number(storedValues[idx]) || 0;
        const actualCount = userJobCounts[userId] || 0;
        if (storedCount !== actualCount) {
          Logger.warn("Correcting stale active_jobs counter", {
            userId,
            storedCount,
            actualCount,
          });
          corrections.push(
            actualCount === 0
              ? redisConnection.del(key)
              : redisConnection.set(key, String(actualCount), "EX", 24 * 60 * 60),
          );
        }
      }

      if (corrections.length > 0) {
        await Promise.all(corrections);
      }
    }

    if (failedRemoved.length > 0 || completedRemoved.length > 0) {
      Logger.info("Queue cleanup completed", {
        failedRemoved: failedRemoved.length,
        completedRemoved: completedRemoved.length,
      });
    }
  } catch (err) {
    Logger.error("Queue cleanup failed", { error: err.message });
  }
});

Logger.info("Scheduler initialized");

// ── Startup: sync org member limits from org plan ─────────────────────────
// B2B: all members inherit limits from their org's plan (school_starter / school_pro / enterprise).
// This ensures limits stay in sync if an org's plan changes.
setImmediate(async () => {
  try {
    const User = require("./models/User");
    const Organization = require("./models/Organization");
    const PricingConfig = require("./models/PricingConfig");
    const config = await PricingConfig.getConfig();
    if (!config?.tiers) {
      Logger.warn("PricingConfig not seeded yet — skipping org limits sync");
      return;
    }
    const orgs = await Organization.find({ isActive: true }, "plan").lean();
    for (const org of orgs) {
      const planLimits = config.tiers[org.plan]?.limits;
      if (!planLimits) continue;
      await User.updateMany(
        { organizationId: org._id, isActive: true },
        { $set: { limits: planLimits } },
      );
    }
    if (orgs.length > 0) {
      Logger.info("Org member limits synced from plan configs", { orgCount: orgs.length });
    }
  } catch (err) {
    Logger.error("Org member limits sync failed", { error: err.message });
  }
});

module.exports = { cron };
