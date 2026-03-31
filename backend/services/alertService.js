const SystemAlert = require('../models/SystemAlert');
const Logger = require('../logger');
const mongoose = require('mongoose');
const { taskQueue } = require('./taskQueue');
let emailService;
try {
  emailService = require('./emailService');
} catch (err) {
  Logger.warn('emailService not available for alerts', { error: err.message });
  emailService = null;
}

class AlertService {
  static async createAlert(typeOrObj, severity, service, message, details = {}) {
    // Support both object style: createAlert({ type, severity, service, message, details })
    // and positional style:       createAlert(type, severity, service, message, details)
    let type;
    if (typeOrObj && typeof typeOrObj === 'object') {
      ({ type, severity, service, message, details = {} } = typeOrObj);
    } else {
      type = typeOrObj;
    }

    try {
      const alert = await SystemAlert.create({
        type,
        severity,
        service,
        message,
        details,
        status: 'active'
      });

      Logger.info('Alert created', { alertId: alert._id, type, severity, service });

      // For critical alerts, you might want to send notifications
      if (severity === 'critical') {
        // TODO: Send email/SMS notification
      }

      return alert;
    } catch (err) {
      Logger.error('Failed to create alert', { error: err.message });
      throw err;
    }
  }

  static async notifyAdmins(alert) {
    try {
      const User = require('../models/User');
      const admins = await User.find({
        role: { $in: ['admin', 'superadmin'] },
        'preferences.emailNotifications': true
      }).select('email');

      const emailPromises = admins.map(admin =>
        emailService?.sendAlertEmail?.(admin.email, alert)
      ).filter(Boolean);

      await Promise.all(emailPromises);

      await SystemAlert.findByIdAndUpdate(alert._id, {
        notificationSent: true
      });

      Logger.info('Admin notifications sent', {
        alertId: alert._id,
        recipientCount: admins.length
      });
    } catch (err) {
      Logger.error('Admin notification error', { error: err.message });
    }
  }

  static async checkSystemHealth() {
    const checks = {
      mongodb: false,
      redis: false,
      s3: false,
      memory: true
    };

    // Check MongoDB
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.db.admin().ping();
        checks.mongodb = true;
      }
    } catch (err) {
      Logger.error('MongoDB health check failed', { error: err.message });
    }

    // Check Redis
    try {
      const { isRedisReady, getRedisClient } = require('../redisClient');
      if (isRedisReady()) {
        // Actually ping to confirm the connection is alive
        const redis = getRedisClient();
        await redis.ping();
        checks.redis = true;
      } else {
        // Client exists but not ready (reconnecting or never connected)
        checks.redis = false;
        Logger.warn('Redis health check: client not ready');
      }
    } catch (err) {
      // Redis is configured but unreachable
      checks.redis = false;
      Logger.error('Redis health check failed', { error: err.message });
    }

    // Check S3 (basic check)
    try {
      const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
      const s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
      });

      if (process.env.S3_BUCKET_NAME) {
        await s3Client.send(new HeadBucketCommand({
          Bucket: process.env.S3_BUCKET_NAME
        }));
        checks.s3 = true;
      } else {
        checks.s3 = true; // No S3 configured, skip check
      }
    } catch (err) {
      Logger.error('S3 health check failed', { error: err.message });
    }

    // Check memory usage
    const memUsage = process.memoryUsage();
    const memoryPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    checks.memory = memoryPercent < 90; // Alert if using more than 90%

    return checks;
  }

  static async monitorApiPerformance() {
    const ApiUsage = require('../models/ApiUsage');

    // Check for slow endpoints in last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const slowEndpoints = await ApiUsage.aggregate([
      {
        $match: {
          timestamp: { $gte: oneHourAgo },
          responseTime: { $gt: 5000 }
        }
      },
      {
        $group: {
          _id: '$endpoint',
          avgResponseTime: { $avg: '$responseTime' },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gte: 10 } } },
      { $sort: { avgResponseTime: -1 } }
    ]);

    if (slowEndpoints.length > 0) {
      await this.createAlert({
        type: 'performance',
        severity: 'medium',
        service: 'api',
        message: `${slowEndpoints.length} endpoints showing slow response times`,
        details: { endpoints: slowEndpoints }
      });
    }

    // Check error rate
    const errorRate = await ApiUsage.aggregate([
      {
        $match: {
          timestamp: { $gte: oneHourAgo }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          errors: {
            $sum: {
              $cond: [{ $gte: ['$statusCode', 400] }, 1, 0]
            }
          }
        }
      }
    ]);

    if (errorRate[0]?.total > 0) {
      const errorPercentage = (errorRate[0].errors / errorRate[0].total) * 100;

      if (errorPercentage > 10) {
        await this.createAlert({
          type: 'api',
          severity: 'high',
          service: 'api',
          message: `Error rate at ${errorPercentage.toFixed(2)}% in the last hour`,
          details: {
            total: errorRate[0].total,
            errors: errorRate[0].errors,
            percentage: errorPercentage
          }
        });
      }
    }
  }

  static async monitorTaskQueue() {
    try {
      const { taskQueue } = require('./taskQueue');
      const jobCounts = await taskQueue.getJobCounts();
      const totalPending = (jobCounts.wait || 0) + (jobCounts.active || 0) + (jobCounts.delayed || 0);

      if (totalPending > 100) {
        await this.createAlert({
          type: 'queue',
          severity: totalPending > 200 ? 'critical' : 'high',
          service: 'task-queue',
          message: `AI Quiz Queue has ${totalPending} pending jobs`,
          details: { jobCounts }
        });
      }
      Logger.info('Queue monitoring status', {
        totalPending,
        jobCounts,
        failedCount: jobCounts.failed || 0,
        completedCount: jobCounts.completed || 0
      });
    } catch (err) {
      Logger.error('Queue monitoring error', { error: err.message });
    }
  }

  static async getActiveAlerts(filter = {}) {
    try {
      return await SystemAlert.find({ status: 'active', ...filter })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
    } catch (err) {
      Logger.error('Failed to get alerts', { error: err.message });
      return [];
    }
  }
}

// Schedule periodic health checks — store IDs for cleanup
const _healthCheckInterval = setInterval(() => {
  AlertService.checkSystemHealth().catch(err =>
    Logger.error('Health check error', { error: err.message })
  );
}, 5 * 60 * 1000); // Every 5 minutes

const _apiMonitorInterval = setInterval(() => {
  AlertService.monitorApiPerformance().catch(err =>
    Logger.error('API monitoring error', { error: err.message })
  );
}, 10 * 60 * 1000); // Every 10 minutes

const _taskQueueInterval = setInterval(() => {
  AlertService.monitorTaskQueue().catch(err =>
    Logger.error('Task Queue monitoring error', { error: err.message })
  );
}, 2 * 60 * 1000); // Every 2 minutes

// Graceful shutdown: clear intervals
process.on('SIGTERM', () => {
  clearInterval(_healthCheckInterval);
  clearInterval(_apiMonitorInterval);
  clearInterval(_taskQueueInterval);
});
process.on('SIGINT', () => {
  clearInterval(_healthCheckInterval);
  clearInterval(_apiMonitorInterval);
  clearInterval(_taskQueueInterval);
});

module.exports = AlertService;