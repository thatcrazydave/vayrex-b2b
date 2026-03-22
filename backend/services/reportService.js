const User = require('../models/user');
const Question = require('../models/questions');
const Result = require('../models/result');
const PdfLibrary = require('../models/PdfLibrary');
const Contact = require('../models/contact');
const SystemAlert = require('../models/SystemAlert');
const ApiUsage = require('../models/ApiUsage');
const emailService = require('./emailService');
const Logger = require('../logger');
const BackupHistory = require('../models/BackupHistory');
const FlaggedContent = require('../models/FlaggedContent');

class ReportService {
  async generateWeeklyReport() {
    try {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const [
        newUsers,
        totalUploads,
        examsTaken,
        avgScoreData,
        topTopics,
        alertCount,
        criticalAlerts,
        storageData,
        activeUsers,
        apiCalls,
        avgResponseTimeData
      ] = await Promise.all([
        User.countDocuments({ createdAt: { $gte: oneWeekAgo } }),
        PdfLibrary.countDocuments({ uploadedAt: { $gte: oneWeekAgo } }),
        Result.countDocuments({ createdAt: { $gte: oneWeekAgo } }),
        Result.aggregate([
          { $match: { createdAt: { $gte: oneWeekAgo } } },
          { $group: { _id: null, avg: { $avg: '$percentage' } } }
        ]),
        Question.aggregate([
          { $group: { _id: '$topic', questions: { $sum: 1 } } },
          {
            $lookup: {
              from: 'results',
              let: { topic: '$_id' },
              pipeline: [
                { $match: { $expr: { $eq: ['$topic', '$$topic'] } } }
              ],
              as: 'exams'
            }
          },
          {
            $project: {
              name: '$_id',
              questions: 1,
              exams: { $size: '$exams' }
            }
          },
          { $sort: { questions: -1 } },
          { $limit: 5 }
        ]),
        SystemAlert.countDocuments({ createdAt: { $gte: oneWeekAgo } }),
        SystemAlert.countDocuments({ 
          createdAt: { $gte: oneWeekAgo },
          severity: 'critical'
        }),
        PdfLibrary.aggregate([
          { $group: { _id: null, total: { $sum: '$fileSize' } } }
        ]),
        User.countDocuments({ 
          lastLogin: { $gte: oneWeekAgo },
          isActive: true
        }),
        ApiUsage.countDocuments({ timestamp: { $gte: oneWeekAgo } }),
        ApiUsage.aggregate([
          { $match: { timestamp: { $gte: oneWeekAgo } } },
          { $group: { _id: null, avg: { $avg: '$responseTime' } } }
        ])
      ]);
      
      const reportData = {
        newUsers,
        totalUploads,
        examsTaken,
        avgScore: Math.round(avgScoreData[0]?.avg || 0),
        topTopics,
        alertCount,
        criticalAlerts,
        storageUsed: ((storageData[0]?.total || 0) / (1024 * 1024 * 1024)).toFixed(2),
        storageTotal: 50, // Your limit
        activeUsers,
        apiCalls,
        avgResponseTime: Math.round(avgResponseTimeData[0]?.avg || 0)
      };

      const report = {
        newUsers,
        activeUsers,
        totalUploads,
        examsTaken,
        avgScore: avgScoreData[0]?.avg || 0,
        topTopics,
        alertCount,
        criticalAlerts,
        storageUsed: (storageData[0]?.total || 0) / (1024 * 1024 * 1024), // Convert to GB
        storageTotal: 100, // Configure this
        apiCalls,
        avgResponseTime: avgResponseTimeData[0]?.avg || 0,
        generatedAt: new Date().toISOString()
      };

      // Send to all admins who opted in
      const admins = await User.find({
        role: { $in: ['admin', 'superadmin'] },
        'preferences.weeklyReports': true
      }).select('email');
      
      for (const admin of admins) {
        await emailService.sendWeeklyReport(admin.email, reportData);
      }
      
      Logger.info('Weekly reports sent', { recipientCount: admins.length });
      
      return reportData;
      
    } catch (err) {
      Logger.error('Weekly report generation error', { error: err.message });
      throw err;
    }
  }

  async generateReport({ type, period, format, generatedBy }) {
    try {
      const startDate = new Date(Date.now() - parseInt(period) * 24 * 60 * 60 * 1000);
      let reportData = {
        title: `${type.replace('_', ' ').toUpperCase()} Report`,
        period: `${period} days`,
        generatedAt: new Date().toISOString(),
        generatedBy
      };

      switch (type) {
        case 'user_activity':
          reportData.data = await this.generateUserActivityReport(startDate);
          break;

        case 'system_performance':
          reportData.data = await this.generateSystemPerformanceReport(startDate);
          break;

        case 'content_summary':
          reportData.data = await this.generateContentSummaryReport(startDate);
          break;

        case 'financial':
          reportData.data = await this.generateFinancialReport(startDate);
          break;

        default:
          throw new Error('Invalid report type');
      }

      // Save to S3 and BackupHistory
      const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
      const s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
      });

      const reportJson = JSON.stringify(reportData, null, 2);
      const reportKey = `reports/${type}_${Date.now()}.json`;

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: reportKey,
        Body: reportJson,
        ContentType: 'application/json'
      }));

      const reportHistory = await BackupHistory.create({
        type: 'report',
        s3Key: reportKey,
        size: Buffer.byteLength(reportJson),
        createdBy: generatedBy,
        metadata: { reportType: type, period },
        status: 'completed'
      });

      Logger.info('Report generated successfully', {
        reportId: reportHistory._id,
        type
      });

      return reportData;

    } catch (err) {
      Logger.error('Report generation failed', { error: err.message });
      throw err;
    }
  }

  async generateUserActivityReport(startDate) {
    const [newUsers, activeUsers, topUsers, userGrowth] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: startDate } }),
      User.countDocuments({ 
        lastLogin: { $gte: startDate },
        isActive: true 
      }),
      Result.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { 
          $group: { 
            _id: '$userId', 
            examCount: { $sum: 1 },
            avgScore: { $avg: '$percentage' }
          } 
        },
        { $sort: { examCount: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        {
          $project: {
            username: '$user.username',
            email: '$user.email',
            examCount: 1,
            avgScore: 1
          }
        }
      ]),
      User.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    return { 
      newUsers, 
      activeUsers, 
      topUsers,
      userGrowth
    };
  }

  async generateSystemPerformanceReport(startDate) {
    const [avgResponseTime, errorRate, totalRequests, endpointStats] = await Promise.all([
      ApiUsage.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        { $group: { _id: null, avg: { $avg: '$responseTime' } } }
      ]),
      ApiUsage.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            errors: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } }
          }
        }
      ]),
      ApiUsage.countDocuments({ timestamp: { $gte: startDate } }),
      ApiUsage.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        {
          $group: {
            _id: '$endpoint',
            requests: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' }
          }
        },
        { $sort: { requests: -1 } },
        { $limit: 10 }
      ])
    ]);

    return {
      avgResponseTime: avgResponseTime[0]?.avg || 0,
      errorRate: errorRate[0] ? (errorRate[0].errors / errorRate[0].total) * 100 : 0,
      totalRequests,
      topEndpoints: endpointStats
    };
  }

  async generateContentSummaryReport(startDate) {
    const [topicStats, totalQuestions, flaggedContent] = await Promise.all([
      Question.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: '$topic',
            questionCount: { $sum: 1 },
            avgQuality: { $avg: '$qualityScore' },
            uniqueUsers: { $addToSet: '$userId' }
          }
        },
        {
          $project: {
            topic: '$_id',
            questionCount: 1,
            avgQuality: 1,
            userCount: { $size: '$uniqueUsers' }
          }
        },
        { $sort: { questionCount: -1 } }
      ]),
      Question.countDocuments({ createdAt: { $gte: startDate } }),
      FlaggedContent.countDocuments({ 
        createdAt: { $gte: startDate },
        status: 'pending'
      })
    ]);

    return {
      topicStats,
      totalQuestions,
      flaggedContent
    };
  }

  async generateFinancialReport(startDate) {
    // Placeholder - implement based on your business model
    const totalUsers = await User.countDocuments({ createdAt: { $gte: startDate } });
    const activeUsers = await User.countDocuments({ 
      lastLogin: { $gte: startDate },
      isActive: true 
    });

    return {
      totalRevenue: 0, // Implement if you have payment system
      newSubscriptions: totalUsers,
      activeSubscriptions: activeUsers,
      churnRate: 0,
      averageRevenuePerUser: 0
    };
  }

  async scheduleWeeklyReports() {
    // This would be called by a cron job
    try {
      const report = await this.generateWeeklyReport();
      Logger.info('Scheduled weekly report completed', { report });
      return report;
    } catch (err) {
      Logger.error('Scheduled report failed', { error: err.message });
      throw err;
    }
  }
}

// Schedule weekly reports (Sundays at 9 AM)
const reportService = new ReportService();

function scheduleWeeklyReports() {
  const now = new Date();
  const nextSunday = new Date();
  nextSunday.setDate(now.getDate() + (7 - now.getDay()));
  nextSunday.setHours(9, 0, 0, 0);
  
  if (nextSunday <= now) {
    nextSunday.setDate(nextSunday.getDate() + 7);
  }
  
  const timeUntilReport = nextSunday - now;
  
  setTimeout(() => {
    reportService.generateWeeklyReport()
      .then(() => {
        Logger.info('Weekly report generated and sent');
        scheduleWeeklyReports(); // Schedule next report
      })
      .catch(err => {
        Logger.error('Weekly report error', { error: err.message });
      });
  }, timeUntilReport);
  
  Logger.info('Next weekly report scheduled', { 
    scheduledTime: nextSunday.toISOString() 
  });
}

scheduleWeeklyReports();

module.exports = reportService;