const Organization = require("../models/Organization");
const { isRedisReady, getRedisClient } = require("../redisClient");
const Logger = require("../logger");

const CACHE_TTL = 60;
const CACHE_PREFIX = "enrollment:";

/**
 * Middleware factory: checks enrollment capacity before allowing new member additions.
 */
function enrollmentGuard() {
  return async (req, res, next) => {
    const orgId = req.orgId;
    if (!orgId) return next();

    try {
      let capacity, count;

      if (isRedisReady()) {
        try {
          const redis = getRedisClient();
          const cached = await redis.get(`${CACHE_PREFIX}${orgId}`);
          if (cached) {
            const parsed = JSON.parse(cached);
            capacity = parsed.capacity;
            count = parsed.count;
          }
        } catch (_) {
          // Redis down — fall through to DB
        }
      }

      if (capacity === undefined) {
        const org = await Organization.findById(orgId)
          .select("enrollmentCapacity enrollmentCount")
          .lean();

        if (!org) {
          return res.status(404).json({
            success: false,
            error: { code: "ORG_NOT_FOUND", message: "Organization not found" },
          });
        }

        capacity = org.enrollmentCapacity;
        count = org.enrollmentCount || 0;

        if (isRedisReady()) {
          try {
            const redis = getRedisClient();
            await redis.set(`${CACHE_PREFIX}${orgId}`, JSON.stringify({ capacity, count }), {
              EX: CACHE_TTL,
            });
          } catch (_) {}
        }
      }

      if (count >= capacity) {
        Logger.warn("Enrollment capacity reached", { orgId, capacity, count });
        return res.status(403).json({
          success: false,
          error: {
            code: "ENROLLMENT_CAPACITY_REACHED",
            message: `This organization has reached its enrollment capacity of ${capacity} members. Please contact support to increase your capacity.`,
          },
        });
      }

      if (count >= capacity * 0.9) {
        res.set("X-Enrollment-Warning", "approaching-capacity");
        res.set("X-Enrollment-Usage", `${count}/${capacity}`);
        Logger.info("Enrollment approaching capacity", {
          orgId,
          usage: `${count}/${capacity}`,
          percent: Math.round((count / capacity) * 100),
        });
      }

      next();
    } catch (err) {
      Logger.error("Enrollment guard error", { error: err.message, orgId });
      // Fail-open: don't block enrollment if the guard itself fails
      next();
    }
  };
}

/**
 * Invalidate enrollment cache after a member is added or removed.
 */
async function invalidateEnrollmentCache(orgId) {
  if (!isRedisReady()) return;
  try {
    const redis = getRedisClient();
    await redis.del(`${CACHE_PREFIX}${orgId}`);
  } catch (_) {}
}

module.exports = { enrollmentGuard, invalidateEnrollmentCache };
