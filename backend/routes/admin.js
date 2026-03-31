const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { adminAuth, superAdminAuth } = require('../middleware/adminAuth');
const auditLogger = require('../middleware/auditLogger');
const User = require('../models/User');
const Question = require('../models/questions');
const Result = require('../models/result');
const PdfLibrary = require('../models/PdfLibrary');
const Contact = require('../models/contact');
const AuditLog = require('../models/AuditLog');
const SystemAlert = require('../models/SystemAlert');
const ApiUsage = require('../models/ApiUsage');
const FlaggedContent = require('../models/FlaggedContent');
const BackupHistory = require('../models/BackupHistory');
const backupService = require('../services/backupService');
const reportService = require('../services/reportService');
const AlertService = require('../services/alertService');
const emailService = require('../services/emailService');
const PricingConfig = require('../models/PricingConfig');
const Logger = require('../logger');
const mongoose = require('mongoose');
const { devNull } = require('os');

// Sanitize pagination params to prevent negative skip or DoS via huge limits
const sanitizePagination = (rawPage, rawLimit, defaultLimit = 20) => {
  const page = Math.max(1, parseInt(rawPage) || 1);
  const limit = Math.min(1000, Math.max(1, parseInt(rawLimit) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// Helper to safely check if model exists and has data
const safeCount = async (Model, filter = {}) => {
  try {
    if (!Model) return 0;
    return await Model.countDocuments(filter);
  } catch (err) {
    Logger.warn(`Count failed for model`, { error: err.message });
    return 0;
  }
};

const safeFind = async (Model, filter = {}, options = {}) => {
  try {
    if (!Model) return [];
    let query = Model.find(filter);
    if (options.select) query = query.select(options.select);
    if (options.sort) query = query.sort(options.sort);
    if (options.limit) query = query.limit(options.limit);
    if (options.skip) query = query.skip(options.skip);
    if (options.populate) query = query.populate(options.populate);
    if (options.lean !== false) query = query.lean();
    return await query;
  } catch (err) {
    Logger.warn(`Find failed for model`, { error: err.message });
    return [];
  }
};

const safeAggregate = async (Model, pipeline = []) => {
  try {
    if (!Model) return [];
    return await Model.aggregate(pipeline);
  } catch (err) {
    Logger.warn(`Aggregate failed for model`, { error: err.message });
    return [];
  }
};

// Middleware to check admin access
router.use(authenticateToken);
router.use(adminAuth);

// ===== ADMIN VERIFICATION ENDPOINT =====

// Lightweight endpoint for frontend to verify admin access
router.get('/verify-access', async (req, res) => {
  try {
    // If we reached here, authenticateToken and adminAuth passed
    res.json({
      success: true,
      verified: true,
      role: req.user.role,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    Logger.error('Admin verification error', {
      userId: req.user?.id,
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_ERROR',
        message: 'Unable to verify admin access'
      }
    });
  }
});

// ===== BACKUP MANAGEMENT =====

// Get all backups with pagination and stats
router.get('/backups', async (req, res) => {
  try {
    const { page, limit, skip } = sanitizePagination(req.query.page, req.query.limit, 20);

    const [backups, stats, total] = await Promise.all([
      backupService.getBackupHistory(limit, skip),
      backupService.getBackupStats(),
      BackupHistory.countDocuments()
    ]);

    res.json({
      success: true,
      data: {
        backups,
        stats: {
          total: stats.total,
          totalSize: stats.totalSize,
          byStatus: stats.byStatus || {},
          byType: stats.byType || {},
          latest: stats.latest
        },
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalBackups: total,
          backupsPerPage: limit
        }
      }
    });

  } catch (err) {
    Logger.error('Backup list error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'BACKUP_LIST_ERROR',
        message: 'Failed to fetch backups',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Create a new backup - Requires admin or superadmin
router.post('/backups/create', auditLogger('backup_created', 'backup'), async (req, res) => {
  try {
    const { type = 'full', collections = [] } = req.body;

    // Input validation
    if (!['full', 'partial'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_TYPE',
          message: 'Backup type must be "full" or "partial"',
          timestamp: new Date().toISOString()
        }
      });
    }

    // For partial backups, validate collections
    if (type === 'partial') {
      if (!Array.isArray(collections) || collections.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_COLLECTIONS',
            message: 'At least one collection must be selected for partial backup',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Validate collection names
      const validCollections = ['users', 'questions', 'results', 'pdflibrary', 'contacts'];
      const invalidCollections = collections.filter(c => !validCollections.includes(c));

      if (invalidCollections.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_COLLECTIONS',
            message: `Invalid collection names: ${invalidCollections.join(', ')}. Valid collections are: ${validCollections.join(', ')}`,
            timestamp: new Date().toISOString()
          }
        });
      }
    }

    // Verify S3 connection
    const s3Valid = await backupService.validateS3Connection();
    if (!s3Valid) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'S3_UNAVAILABLE',
          message: 'S3 service is not available. Please check AWS credentials configuration.',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Create appropriate backup type
    let backup;
    if (type === 'full') {
      backup = await backupService.createFullBackup(req.user.id, 'manual');
    } else {
      backup = await backupService.createPartialBackup(collections, req.user.id, 'manual');
    }

    Logger.info('Backup created successfully', {
      backupId: backup._id,
      type: backup.type,
      createdBy: req.user.id,
      fileSize: backup.fileSize,
      recordCount: backup.recordCount
    });

    res.json({
      success: true,
      message: 'Backup created successfully',
      data: {
        backup: {
          _id: backup._id,
          type: backup.type,
          status: backup.status,
          fileSize: backup.fileSize,
          recordCount: backup.recordCount,
          collections: backup.collections,
          createdAt: backup.createdAt,
          completedAt: backup.completedAt
        }
      }
    });

  } catch (err) {
    Logger.error('Backup creation error', {
      error: err.message,
      userId: req.user.id,
      stack: err.stack
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'BACKUP_CREATE_ERROR',
        message: err.message || 'Failed to create backup',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Restore a backup - SUPERADMIN ONLY with audit log
router.post('/backups/:id/restore',
  superAdminAuth,
  auditLogger('backup_restored', 'backup'),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Validate MongoDB ObjectId format
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ID',
            message: 'Invalid backup ID format',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Check if backup exists
      const backup = await BackupHistory.findById(id);
      if (!backup) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'BACKUP_NOT_FOUND',
            message: 'Backup not found',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Check backup status
      if (backup.status !== 'completed') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_BACKUP_STATUS',
            message: `Cannot restore backup with status: ${backup.status}. Only completed backups can be restored.`,
            timestamp: new Date().toISOString()
          }
        });
      }

      Logger.warn('Starting backup restoration', {
        backupId: id,
        backupType: backup.type,
        restoredBy: req.user.id,
        collections: backup.collections,
        recordCount: backup.recordCount
      });

      // Start restore process
      const restoredBackup = await backupService.restoreBackup(id, req.user.id);

      Logger.info('Backup restoration completed', {
        backupId: id,
        restoredBy: req.user.id,
        status: restoredBackup.status
      });

      res.json({
        success: true,
        message: 'Backup restored successfully',
        data: {
          backup: {
            _id: restoredBackup._id,
            type: restoredBackup.type,
            status: restoredBackup.status,
            recordCount: restoredBackup.recordCount,
            restoredAt: restoredBackup.restoredAt,
            restoredBy: restoredBackup.restoredBy,
            restoreMetadata: restoredBackup.restoreMetadata
          }
        }
      });

    } catch (err) {
      Logger.error('Backup restoration error', {
        error: err.message,
        backupId: req.params.id,
        userId: req.user.id,
        stack: err.stack
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'BACKUP_RESTORE_ERROR',
          message: err.message || 'Failed to restore backup',
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// Download backup metadata/info
router.get('/backups/:id/download',
  auditLogger('backup_downloaded', 'backup'),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ID',
            message: 'Invalid backup ID format',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Get backup with populated user info
      const backup = await BackupHistory.findById(id)
        .populate('initiatedBy', 'username email')
        .populate('createdBy', 'username email');

      if (!backup) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'BACKUP_NOT_FOUND',
            message: 'Backup not found',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Verify S3 URL exists
      if (!backup.s3Url || !backup.backupKey) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_S3_URL',
            message: 'S3 URL not available for this backup',
            timestamp: new Date().toISOString()
          }
        });
      }

      Logger.info('Backup download metadata requested', {
        backupId: id,
        requestedBy: req.user.id,
        backupType: backup.type
      });

      // Return backup metadata and download info
      res.json({
        success: true,
        data: {
          backup: {
            _id: backup._id,
            type: backup.type,
            status: backup.status,
            fileSize: backup.fileSize,
            recordCount: backup.recordCount,
            collections: backup.collections,
            createdAt: backup.createdAt,
            completedAt: backup.completedAt,
            createdBy: backup.createdBy,
            initiatedBy: backup.initiatedBy,
            metadata: backup.metadata
          },
          download: {
            url: backup.s3Url,
            fileName: `backup_${backup.type}_${backup._id}_${new Date(backup.createdAt).getTime()}.json.gz`,
            fileSize: backup.fileSize,
            contentType: 'application/gzip',
            instructions: 'Download and decompress using gunzip to restore locally'
          }
        }
      });

    } catch (err) {
      Logger.error('Backup download error', {
        error: err.message,
        backupId: req.params.id,
        userId: req.user.id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'DOWNLOAD_ERROR',
          message: 'Failed to generate download metadata',
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// Delete a backup - SUPERADMIN ONLY
router.delete('/backups/:id',
  superAdminAuth,
  auditLogger('backup_deleted', 'backup'),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Validate ObjectId
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ID',
            message: 'Invalid backup ID format',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Check if backup exists
      const backup = await BackupHistory.findById(id);
      if (!backup) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'BACKUP_NOT_FOUND',
            message: 'Backup not found',
            timestamp: new Date().toISOString()
          }
        });
      }

      Logger.info('Starting backup deletion', {
        backupId: id,
        deletedBy: req.user.id,
        backupType: backup.type,
        fileSize: backup.fileSize
      });

      // Delete backup from S3 and database
      await backupService.deleteBackup(id, req.user.id);

      Logger.info('Backup deleted successfully', {
        backupId: id,
        deletedBy: req.user.id
      });

      res.json({
        success: true,
        message: 'Backup deleted successfully',
        data: {
          backupId: id,
          timestamp: new Date().toISOString()
        }
      });

    } catch (err) {
      Logger.error('Backup deletion error', {
        error: err.message,
        backupId: req.params.id,
        userId: req.user.id,
        stack: err.stack
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'BACKUP_DELETE_ERROR',
          message: err.message || 'Failed to delete backup',
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// Get backup statistics
router.get('/backups/stats/overview', async (req, res) => {
  try {
    const stats = await backupService.getBackupStats();

    res.json({
      success: true,
      data: {
        stats: {
          total: stats.total,
          totalSize: stats.totalSize,
          byStatus: stats.byStatus || {},
          byType: stats.byType || {},
          latest: stats.latest,
          oldestCompleted: stats.oldestCompleted
        }
      }
    });

  } catch (err) {
    Logger.error('Backup stats error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'BACKUP_STATS_ERROR',
        message: 'Failed to fetch backup statistics',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Cleanup old backups (manual trigger)
router.post('/backups/cleanup/old',
  superAdminAuth,
  auditLogger('backup_cleanup_triggered', 'backup'),
  async (req, res) => {
    try {
      const { daysToKeep = 30 } = req.body;

      if (typeof daysToKeep !== 'number' || daysToKeep < 7) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_DAYS',
            message: 'daysToKeep must be a number >= 7',
            timestamp: new Date().toISOString()
          }
        });
      }

      Logger.info('Starting backup cleanup', {
        daysToKeep,
        triggeredBy: req.user.id
      });

      const result = await backupService.deleteOldBackups(daysToKeep);

      Logger.info('Backup cleanup completed', {
        deletedCount: result.deletedCount,
        failedCount: result.failedCount,
        triggeredBy: req.user.id
      });

      res.json({
        success: true,
        message: `Backup cleanup completed. Deleted ${result.deletedCount} backups.`,
        data: {
          deletedCount: result.deletedCount,
          failedCount: result.failedCount,
          daysToKeep
        }
      });

    } catch (err) {
      Logger.error('Backup cleanup error', {
        error: err.message,
        userId: req.user.id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'CLEANUP_ERROR',
          message: err.message || 'Failed to cleanup old backups',
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// ===== ADMIN DASHBOARD =====
router.get('/dashboard', async (req, res) => {
  try {
    // Safely get all counts with fallbacks
    const results = await Promise.allSettled([
      User.countDocuments({ isDeleted: { $ne: true } }),                    // 0: totalUsers
      User.countDocuments({ isActive: true, isDeleted: { $ne: true } }),   // 1: activeUsers
      PdfLibrary.countDocuments().catch(() => 0),                           // 2: totalUploads
      Question.countDocuments().catch(() => 0),                             // 3: totalQuestions
      Result.countDocuments().catch(() => 0),                               // 4: totalResults
      Contact.countDocuments({ status: 'new' }).catch(() => 0),            // 5: pendingContacts
      User.countDocuments({                                                 // 6: recentSignups
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        isDeleted: { $ne: true }
      }).catch(() => 0),
      PdfLibrary.aggregate([                                                // 7: storageUsed
        { $group: { _id: null, totalSize: { $sum: '$fileSize' } } }
      ]).catch(() => []),
      SystemAlert ? SystemAlert.countDocuments({ status: 'active' }).catch(() => 0) : Promise.resolve(0), // 8: activeAlerts
      ApiUsage ? ApiUsage.countDocuments({                                  // 9: todayApiCalls
        timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }).catch(() => 0) : Promise.resolve(0)
    ]);

    // Extract values safely
    const getValue = (result, defaultVal = 0) =>
      result.status === 'fulfilled' ? result.value : defaultVal;

    const totalUsers = getValue(results[0]);
    const activeUsers = getValue(results[1]);
    const totalUploads = getValue(results[2]);
    const totalQuestions = getValue(results[3]);
    const totalResults = getValue(results[4]);
    const pendingContacts = getValue(results[5]);
    const recentSignups = getValue(results[6]);
    const storageUsed = getValue(results[7], []);
    const activeAlerts = getValue(results[8]);
    const todayApiCalls = getValue(results[9]);

    // User growth data
    let userGrowth = [];
    try {
      userGrowth = await User.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
            isDeleted: { $ne: true }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);
    } catch (err) {
      Logger.warn('User growth aggregation failed:', err.message);
    }

    // Top uploaders
    let topUploaders = [];
    try {
      topUploaders = await PdfLibrary.aggregate([
        {
          $group: {
            _id: '$userId',
            uploadCount: { $sum: 1 },
            questionCount: { $sum: '$numberOfQuestions' }
          }
        },
        { $sort: { uploadCount: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            userId: '$_id',
            username: { $ifNull: ['$user.username', 'Unknown'] },
            email: { $ifNull: ['$user.email', 'Unknown'] },
            uploadCount: 1,
            questionCount: 1
          }
        }
      ]);
    } catch (err) {
      Logger.warn('Top uploaders aggregation failed:', err.message);
    }

    // Exam stats
    let examStats = [{ avgPercentage: 0, totalExams: 0, avgScore: 0, avgTotal: 0 }];
    try {
      const stats = await Result.aggregate([
        {
          $group: {
            _id: null,
            avgPercentage: { $avg: '$percentage' },
            totalExams: { $sum: 1 },
            avgScore: { $avg: '$score' },
            avgTotal: { $avg: '$totalQuestions' }
          }
        }
      ]);
      if (stats.length > 0) {
        examStats = stats;
      }
    } catch (err) {
      Logger.warn('Exam stats aggregation failed:', err.message);
    }

    // Recent activity
    let recentActivity = [];
    try {
      if (AuditLog) {
        recentActivity = await AuditLog.find()
          .sort({ createdAt: -1 })
          .limit(10)
          .populate('userId', 'username email')
          .lean();
      }
    } catch (err) {
      Logger.warn('Recent activity fetch failed:', err.message);
    }

    // Count admin users
    let adminCount = 0;
    try {
      adminCount = await User.countDocuments({
        role: { $in: ['admin', 'superadmin'] },
        isDeleted: { $ne: true }
      });
    } catch (err) {
      Logger.warn('Admin count failed:', err.message);
    }

    // Recent users (for frontend display)
    let recentUsers = [];
    try {
      recentUsers = await User.find({ isDeleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('username email role isActive createdAt')
        .lean();
    } catch (err) {
      Logger.warn('Recent users fetch failed:', err.message);
    }

    // Count total contacts
    let totalContacts = 0;
    try {
      totalContacts = await Contact.countDocuments();
    } catch (err) {
      Logger.warn('Total contacts count failed:', err.message);
    }

    res.json({
      success: true,
      data: {
        overview: {
          totalUsers,
          activeUsers,
          totalUploads,
          totalQuestions,
          totalResults,
          pendingContacts,
          recentSignups,
          storageUsed: storageUsed[0]?.totalSize || 0,
          avgExamScore: Math.round(examStats[0]?.avgPercentage || 0),
          activeAlerts,
          todayApiCalls,
          adminCount,
          totalContacts,
          inactiveUsers: totalUsers - activeUsers
        },
        charts: {
          userGrowth,
          topUploaders
        },
        recentActivity,
        recentUsers,
        timestamp: new Date().toISOString()
      }
    });

  } catch (err) {
    Logger.error('Admin Dashboard error', {
      error: err.message,
      stack: err.stack
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'DASHBOARD_ERROR',
        message: err.message || 'Failed to fetch dashboard stats',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ===== USER MANAGEMENT =====
router.get('/users', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      role = '',
      status = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 20);
    const filter = { isDeleted: { $ne: true } };

    if (search) {
      filter.$or = [
        { username: new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') },
        { fullname: new RegExp(search, 'i') }
      ];
    }

    if (role) filter.role = role;
    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;

    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .sort(sort)
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      User.countDocuments(filter)
    ]);

    // Enrich with stats
    const enrichedUsers = await Promise.all(
      users.map(async (user) => {
        const [uploads, questions, results, lastActivity] = await Promise.all([
          PdfLibrary.countDocuments({ userId: user._id }),
          Question.countDocuments({ userId: user._id }),
          Result.countDocuments({ userId: user._id }),
          AuditLog.findOne({ userId: user._id })
            .sort({ createdAt: -1 })
            .select('createdAt action')
            .lean()
        ]);

        return {
          ...user,
          stats: {
            uploads,
            questions,
            examsTaken: results
          },
          lastActivity: lastActivity?.createdAt || user.lastLogin
        };
      })
    );

    res.json({
      success: true,
      data: {
        users: enrichedUsers,
        pagination: {
          currentPage: safePage,
          totalPages: Math.ceil(total / safeLimit),
          totalUsers: total,
          usersPerPage: safeLimit
        }
      }
    });

  } catch (err) {
    Logger.error('Admin users fetch error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'USERS_FETCH_ERROR',
        message: 'Failed to fetch users',
        timestamp: new Date().toISOString()
      }
    });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).select('-password').lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Get detailed stats
    const [
      uploads,
      questions,
      exams,
      recentActivity,
      avgScore
    ] = await Promise.all([
      PdfLibrary.find({ userId: user._id })
        .sort({ uploadedAt: -1 })
        .limit(10)
        .lean(),
      Question.countDocuments({ userId: user._id }),
      Result.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      AuditLog.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Result.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(id) } },
        { $group: { _id: null, avg: { $avg: '$percentage' } } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        user: {
          ...user,
          stats: {
            totalUploads: uploads.length,
            totalQuestions: questions,
            totalExams: exams.length,
            avgScore: Math.round(avgScore[0]?.avg || 0)
          }
        },
        uploads,
        exams,
        recentActivity
      }
    });

  } catch (err) {
    Logger.error('User detail fetch error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'USER_DETAIL_ERROR',
        message: 'Failed to fetch user details',
        timestamp: new Date().toISOString()
      }
    });
  }
});

router.patch('/users/:id/role', superAdminAuth, auditLogger('user_role_changed', 'user'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['user', 'admin', 'superadmin'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ROLE',
          message: 'Invalid role value',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Increment tokenVersion to invalidate all existing tokens for this user
    const TokenService = require('../services/tokenService');
    await TokenService.revokeAllUserTokens(id);

    const user = await User.findByIdAndUpdate(
      id,
      {
        role,
        updatedAt: new Date(),
        $inc: { tokenVersion: 1 } // Increment version to invalidate tokens
      },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    Logger.info('User role updated', {
      userId: id,
      newRole: role,
      previousTokensInvalidated: true
    });

    res.json({
      success: true,
      data: {
        user,
        message: 'Role updated. User will need to log in again to apply changes.'
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    Logger.error('User role update error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'ROLE_UPDATE_ERROR',
        message: 'Failed to update user role',
        timestamp: new Date().toISOString()
      }
    });
  }
});

router.patch('/users/:id/status', auditLogger('user_status_changed', 'user'), async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const user = await User.findByIdAndUpdate(
      id,
      { isActive, updatedAt: new Date() },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          timestamp: new Date().toISOString()
        }
      });
    }
    res.json({
      success: true,
      data: { user }
    });

  } catch (err) {
    Logger.error('User status update error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'STATUS_UPDATE_ERROR',
        message: 'Failed to update user status',
        timestamp: new Date().toISOString()
      }
    });
  }
});

router.delete('/users/:id', superAdminAuth, auditLogger('user_deleted', 'user'), async (req, res) => {
  try {
    const { id } = req.params;

    // Soft-delete user (consistent with bulk delete)
    const user = await User.findByIdAndUpdate(
      id,
      { isDeleted: true, deletedAt: new Date() },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    res.json({
      success: true,
      message: 'User soft-deleted successfully'
    });

  } catch (err) {
    Logger.error('User deletion error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'USER_DELETE_ERROR',
        message: 'Failed to delete user',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ===== CONTACT MANAGEMENT =====
router.get('/contacts', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status = '',
      priority = '',
      category = ''
    } = req.query;

    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 20);
    const filter = {};

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;

    const [contacts, total, statusCounts] = await Promise.all([
      Contact.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .populate('resolvedBy', 'username email')
        .lean(),
      Contact.countDocuments(filter),
      Contact.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        contacts,
        pagination: {
          currentPage: safePage,
          totalPages: Math.ceil(total / safeLimit),
          totalContacts: total,
          contactsPerPage: safeLimit
        },
        statusCounts: statusCounts.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    });

  } catch (err) {
    Logger.error('Contacts fetch error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'CONTACTS_FETCH_ERROR',
        message: 'Failed to fetch contacts',
        timestamp: new Date().toISOString()
      }
    });
  }
});

router.patch('/contacts/:id', auditLogger('contact_updated', 'contact'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority, category, adminNotes, sendResponse } = req.body;

    const updateData = {
      updatedAt: new Date()
    };

    if (status) {
      updateData.status = status;
      if (status === 'resolved') {
        updateData.resolvedBy = req.user.id;
        updateData.resolvedAt = new Date();
      }
    }
    if (priority) updateData.priority = priority;
    if (category) updateData.category = category;
    if (adminNotes) updateData.adminNotes = adminNotes;

    const contact = await Contact.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('resolvedBy', 'username email');

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CONTACT_NOT_FOUND',
          message: 'Contact message not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Send email response if requested
    if (sendResponse && adminNotes) {
      await emailService.sendContactResponse(contact.email, contact, adminNotes);
    }

    res.json({
      success: true,
      data: { contact }
    });

  } catch (err) {
    Logger.error('Contact update error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'CONTACT_UPDATE_ERROR',
        message: 'Failed to update contact',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ===== RESPOND TO CONTACT =====
router.post('/contacts/:id/respond',
  auditLogger('contact_responded', 'contact'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { response } = req.body;

      if (!response || !response.trim()) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_RESPONSE',
            message: 'Response message is required',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Get the contact
      const contact = await Contact.findById(id);

      if (!contact) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'CONTACT_NOT_FOUND',
            message: 'Contact message not found',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Update contact with response
      contact.adminNotes = response.trim();
      contact.status = 'resolved';
      contact.resolvedBy = req.user.id;
      contact.resolvedAt = new Date();
      await contact.save();

      // Send email response to user
      try {
        await emailService.sendContactResponse(
          contact.email,
          {
            _id: contact._id,
            name: contact.name,
            email: contact.email,
            subject: contact.subject,
            message: contact.message
          },
          response.trim()
        );

        Logger.info('Contact response email sent', {
          contactId: contact._id,
          to: contact.email,
          respondedBy: req.user.id
        });
      } catch (emailError) {
        Logger.error('Failed to send contact response email', {
          contactId: contact._id,
          error: emailError.message
        });

        // Don't fail the request if email fails, but inform the user
        return res.json({
          success: true,
          data: {
            contact,
            warning: 'Response saved but email notification failed to send'
          },
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        data: {
          contact,
          message: 'Response sent successfully'
        },
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      Logger.error('Contact response error', { error: err.message });
      res.status(500).json({
        success: false,
        error: {
          code: 'RESPONSE_ERROR',
          message: 'Failed to send response',
          timestamp: new Date().toISOString()
        }
      });
    }
  }
);

// ===== SYSTEM HEALTH =====
router.get('/system/health', async (req, res) => {
  try {
    const AlertService = require('../services/alertService');

    // Get service health checks
    const services = await AlertService.checkSystemHealth();

    // Get memory usage
    const memUsage = process.memoryUsage();
    const totalMem = require('os').totalmem();
    const freeMem = require('os').freemem();

    // Determine overall status
    let status = 'healthy';
    if (!services.mongodb) status = 'down';
    else if (!services.redis || !services.s3) status = 'degraded';
    else if (!services.memory) status = 'degraded';

    const healthData = {
      status,
      timestamp: new Date().toISOString(),
      services: {
        mongodb: services.mongodb || false,
        redis: services.redis || false,
        s3: services.s3 || false,
        memory: services.memory || false
      },
      memory: {
        heapUsed: memUsage.heapUsed || 0,
        heapTotal: memUsage.heapTotal || 0,
        external: memUsage.external || 0,
        rss: memUsage.rss || 0,
        percentUsed: Math.round(((totalMem - freeMem) / totalMem) * 100)
      },
      uptime: process.uptime() || 0,
      cpu: process.cpuUsage() || { user: 0, system: 0 }
    };

    res.json({
      success: true,
      data: healthData
    });

  } catch (err) {
    Logger.error('Health check error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'HEALTH_CHECK_ERROR',
        message: 'Failed to check system health'
      }
    });
  }
});

// ===== SYSTEM ALERTS =====
router.get('/system/alerts', async (req, res) => {
  try {
    const { severity = '', status = 'active', limit: rawLimit = 50 } = req.query;
    const limit = Math.min(1000, Math.max(1, parseInt(rawLimit) || 50));

    const filter = {};
    if (severity) filter.severity = severity;
    if (status) filter.status = status;

    const [alerts, stats] = await Promise.all([
      SystemAlert.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('resolvedBy', 'username email')
        .lean(),
      SystemAlert.aggregate([
        { $group: { _id: '$severity', count: { $sum: 1 } } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        alerts,
        stats: stats.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    });

  } catch (err) {
    Logger.error('Alerts fetch error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'ALERTS_FETCH_ERROR',
        message: 'Failed to fetch alerts',
        timestamp: new Date().toISOString()
      }
    });
  }
});

router.patch('/system/alerts/:id', auditLogger('alert_resolved', 'alert'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, resolution } = req.body;

    const alert = await SystemAlert.findByIdAndUpdate(
      id,
      {
        status,
        resolution,
        resolvedBy: req.user.id,
        resolvedAt: new Date()
      },
      { new: true }
    ).populate('resolvedBy', 'username email');

    if (!alert) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ALERT_NOT_FOUND',
          message: 'Alert not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    res.json({
      success: true,
      data: { alert }
    });

  } catch (err) {
    Logger.error('Alert update error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'ALERT_UPDATE_ERROR',
        message: 'Failed to update alert',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ===== ANALYTICS =====
router.get('/analytics', async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const startDate = new Date(Date.now() - parseInt(period) * 24 * 60 * 60 * 1000);

    const [
      dailyActiveUsers,
      topicPopularity,
      examCompletionRate,
      peakUsageHours,
      retentionData
    ] = await Promise.all([
      // Daily active users
      User.aggregate([
        {
          $match: {
            lastLogin: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$lastLogin' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),

      // Topic popularity
      Question.aggregate([
        {
          $group: {
            _id: '$topic',
            questionCount: { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' }
          }
        },
        {
          $project: {
            topic: '$_id',
            questionCount: 1,
            userCount: { $size: '$uniqueUsers' }
          }
        },
        { $sort: { questionCount: -1 } },
        { $limit: 10 }
      ]),

      // Exam completion rate
      Result.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            totalExams: { $sum: 1 },
            completedExams: {
              $sum: { $cond: [{ $gte: ['$percentage', 50] }, 1, 0] }
            },
            avgScore: { $avg: '$percentage' }
          }
        }
      ]),

      // Peak usage hours
      Result.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: { $hour: '$createdAt' },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]),

      // User retention
      User.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate }
          }
        },
        {
          $lookup: {
            from: 'results',
            localField: '_id',
            foreignField: 'userId',
            as: 'exams'
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
            },
            signups: { $sum: 1 },
            activeUsers: {
              $sum: {
                $cond: [{ $gt: [{ $size: '$exams' }, 0] }, 1, 0]
              }
            }
          }
        },
        {
          $project: {
            date: '$_id',
            signups: 1,
            activeUsers: 1,
            retentionRate: {
              $multiply: [
                { $divide: ['$activeUsers', '$signups'] },
                100
              ]
            }
          }
        },
        { $sort: { date: 1 } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        engagement: {
          dailyActiveUsers,
          topicPopularity,
          examCompletionRate: examCompletionRate[0] || {},
          peakUsageHours
        },
        retention: retentionData,
        timestamp: new Date().toISOString()
      }
    });

  } catch (err) {
    Logger.error('Analytics fetch error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to fetch analytics',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ===== API USAGE STATISTICS =====
router.get('/api-usage', async (req, res) => {
  try {
    const { period = '7' } = req.query;
    const startDate = new Date(Date.now() - parseInt(period) * 24 * 60 * 60 * 1000);

    const [
      endpointStats,
      userStats,
      errorStats,
      timeSeriesData
    ] = await Promise.all([
      // Most used endpoints
      ApiUsage.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: '$endpoint',
            totalRequests: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' },
            errorCount: {
              $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] }
            }
          }
        },
        { $sort: { totalRequests: -1 } },
        { $limit: 20 }
      ]),

      // Top API users
      ApiUsage.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate },
            userId: { $exists: true }
          }
        },
        {
          $group: {
            _id: '$userId',
            requestCount: { $sum: 1 }
          }
        },
        { $sort: { requestCount: -1 } },
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
            userId: '$_id',
            username: '$user.username',
            email: '$user.email',
            requestCount: 1
          }
        }
      ]),

      // Error breakdown
      ApiUsage.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate },
            statusCode: { $gte: 400 }
          }
        },
        {
          $group: {
            _id: '$statusCode',
            count: { $sum: 1 },
            endpoints: { $addToSet: '$endpoint' }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Time series data
      ApiUsage.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d-%H',
                date: '$timestamp'
              }
            },
            requests: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        endpoints: endpointStats,
        topUsers: userStats,
        errors: errorStats,
        timeSeries: timeSeriesData,
        summary: {
          totalRequests: endpointStats.reduce((sum, e) => sum + e.totalRequests, 0),
          totalErrors: errorStats.reduce((sum, e) => sum + e.count, 0),
          avgResponseTime: endpointStats.reduce((sum, e) => sum + e.avgResponseTime, 0) / (endpointStats.length || 1)
        }
      }
    });

  } catch (err) {
    Logger.error('API usage stats error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'API_USAGE_ERROR',
        message: 'Failed to fetch API usage stats',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ===== CONTENT MODERATION =====
router.get('/moderation/flagged', async (req, res) => {
  try {
    const { type = '', status = 'pending', limit = 50 } = req.query;

    const filter = {
      status: status
    };
    if (type) filter.contentType = type;

    const flagged = await FlaggedContent.find(filter)
      .populate('contentId')
      .populate('flaggedBy', 'username email')
      .populate('moderatedBy', 'username email')
      .sort({ createdAt: -1 })
      .limit(Math.min(1000, Math.max(1, parseInt(limit) || 50)))
      .lean();

    const stats = await FlaggedContent.aggregate([
      {
        $group: {
          _id: '$contentType',
          total: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        flagged,
        stats: stats.reduce((acc, item) => {
          acc[item._id] = item;
          return acc;
        }, {})
      }
    });

  } catch (err) {
    Logger.error('Moderation fetch error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'MODERATION_ERROR',
        message: 'Failed to fetch flagged content',
        timestamp: new Date().toISOString()
      }
    });
  }
});

router.patch('/moderation/:id', auditLogger('content_moderated', 'flagged_content'), async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reason } = req.body;

    if (!['approve', 'remove', 'warn'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ACTION',
          message: 'Invalid moderation action',
          timestamp: new Date().toISOString()
        }
      });
    }

    const flagged = await FlaggedContent.findByIdAndUpdate(
      id,
      {
        status: action === 'approve' ? 'approved' : 'removed',
        moderatedBy: req.user.id,
        moderatedAt: new Date(),
        moderationReason: reason
      },
      { new: true }
    ).populate('contentId');

    if (!flagged) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Flagged content not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Take action on original content
    if (action === 'remove') {
      const Model = flagged.contentType === 'question' ? Question : Result;
      await Model.findByIdAndUpdate(flagged.contentId, {
        isDeleted: true,
        deletedReason: reason
      });
    }

    res.json({
      success: true,
      data: { flagged }
    });

  } catch (err) {
    Logger.error('Moderation action error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'MODERATION_ACTION_ERROR',
        message: 'Failed to moderate content',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ===== REPORTS =====
router.post('/reports/generate', auditLogger('report_generated', 'report'), async (req, res) => {
  try {
    const { type, period = '30', format = 'json' } = req.body;

    if (!['user_activity', 'system_performance', 'content_summary', 'financial'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REPORT_TYPE',
          message: 'Invalid report type',
          timestamp: new Date().toISOString()
        }
      });
    }

    const report = await reportService.generateReport({
      type,
      period,
      format,
      generatedBy: req.user.id
    });

    res.json({
      success: true,
      data: { report }
    });

  } catch (err) {
    Logger.error('Report generation error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'REPORT_GENERATION_ERROR',
        message: 'Failed to generate report',
        timestamp: new Date().toISOString()
      }
    });
  }
});

router.get('/reports', async (req, res) => {
  try {
    const { page, limit, skip } = sanitizePagination(req.query.page, req.query.limit, 20);

    const [reports, total] = await Promise.all([
      BackupHistory.find({ type: 'report' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'username email')
        .lean(),
      BackupHistory.countDocuments({ type: 'report' })
    ]);

    res.json({
      success: true,
      data: {
        reports,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (err) {
    Logger.error('Reports fetch error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'REPORTS_FETCH_ERROR',
        message: 'Failed to fetch reports',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ===== AUDIT LOGS =====
router.get('/audit-logs', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      action = '',
      userId = '',
      startDate = '',
      endDate = ''
    } = req.query;

    const { page: safePage, limit: safeLimit, skip } = sanitizePagination(page, limit, 20);
    const filter = {};

    if (action) filter.action = action;
    if (userId) filter.userId = userId;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('userId', 'username email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      AuditLog.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          currentPage: safePage,
          totalPages: Math.ceil(total / safeLimit),
          totalLogs: total
        }
      }
    });

  } catch (err) {
    Logger.error('Audit logs fetch error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'AUDIT_LOGS_ERROR',
        message: 'Failed to fetch audit logs',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ===== BULK OPERATIONS =====
router.post('/bulk/users', auditLogger('bulk_user_operation', 'user'), async (req, res) => {
  try {
    const { userIds, action, value } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'User IDs array is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    let result;
    switch (action) {
      case 'activate':
        result = await User.updateMany(
          { _id: { $in: userIds } },
          { isActive: true }
        );
        break;

      case 'deactivate':
        result = await User.updateMany(
          { _id: { $in: userIds } },
          { isActive: false }
        );
        break;

      case 'delete':
        result = await User.updateMany(
          { _id: { $in: userIds } },
          { isDeleted: true, deletedAt: new Date() }
        );
        break;

      case 'changeRole':
        if (!['user', 'admin'].includes(value)) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_ROLE',
              message: 'Invalid role value',
              timestamp: new Date().toISOString()
            }
          });
        }
        result = await User.updateMany(
          { _id: { $in: userIds } },
          { role: value }
        );
        break;

      default:
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_ACTION',
            message: 'Invalid action specified',
            timestamp: new Date().toISOString()
          }
        });
    }

    res.json({
      success: true,
      data: {
        modifiedCount: result.modifiedCount,
        message: `Successfully ${action}d ${result.modifiedCount} users`
      }
    });

  } catch (err) {
    Logger.error('Bulk user action error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'BULK_ACTION_ERROR',
        message: 'Failed to perform bulk action',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ===== DATA EXPORT =====
router.get('/export/users', auditLogger('users_exported', 'export'), async (req, res) => {
  try {
    const { format = 'csv' } = req.query;

    const users = await User.find({ isDeleted: { $ne: true } })
      .select('-password')
      .lean();

    // Enrich with stats
    const enrichedUsers = await Promise.all(
      users.map(async (user) => {
        const [uploads, questions, results] = await Promise.all([
          PdfLibrary.countDocuments({ userId: user._id }),
          Question.countDocuments({ userId: user._id }),
          Result.countDocuments({ userId: user._id })
        ]);

        return {
          id: user._id,
          username: user.username,
          email: user.email,
          fullname: user.fullname || '',
          role: user.role,
          isActive: user.isActive,
          createdAt: user.createdAt,
          lastLogin: user.lastLogin || '',
          uploads,
          questions,
          examsTaken: results
        };
      })
    );

    if (format === 'csv') {
      const fields = ['id', 'username', 'email', 'fullname', 'role', 'isActive',
        'createdAt', 'lastLogin', 'uploads', 'questions', 'examsTaken'];

      let csv = fields.join(',') + '\n';
      enrichedUsers.forEach(user => {
        csv += fields.map(field => {
          const value = user[field];
          return typeof value === 'string' && value.includes(',')
            ? `"${value}"`
            : value;
        }).join(',') + '\n';
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=users_export_${Date.now()}.csv`);
      res.send(csv);
    } else {
      res.json({
        success: true,
        data: { users: enrichedUsers }
      });
    }

  } catch (err) {
    Logger.error('User export error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'EXPORT_ERROR',
        message: 'Failed to export users',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ===== ACTIVITY LOGS =====
router.get('/activity-logs', async (req, res) => {
  try {
    const { page, limit, skip } = sanitizePagination(req.query.page, req.query.limit, 50);

    const [recentUploads, recentExams, recentSignups] = await Promise.all([
      PdfLibrary.find()
        .sort({ uploadedAt: -1 })
        .limit(20)
        .populate('userId', 'username email')
        .lean(),
      Result.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('userId', 'username email')
        .lean(),
      User.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .select('username email createdAt')
        .lean()
    ]);

    const activities = [
      ...recentUploads.map(u => ({
        type: 'upload',
        user: u.userId,
        details: `Uploaded ${u.fileName} (${u.numberOfQuestions} questions)`,
        timestamp: u.uploadedAt
      })),
      ...recentExams.map(e => ({
        type: 'exam',
        user: e.userId,
        details: `Completed exam: ${e.topic} (Score: ${e.percentage}%)`,
        timestamp: e.createdAt
      })),
      ...recentSignups.map(s => ({
        type: 'signup',
        user: s,
        details: `New user registered: ${s.username}`,
        timestamp: s.createdAt
      }))
    ]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(skip, skip + limit);

    res.json({
      success: true,
      data: {
        activities,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(activities.length / limit)
        }
      }
    });

  } catch (err) {
    Logger.error('Activity logs error', { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'ACTIVITY_LOGS_ERROR',
        message: 'Failed to fetch activity logs',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ===== ADMIN: GET PRICING CONFIG =====
router.get('/pricing-config', authenticateToken, adminAuth, async (req, res) => {
  try {
    const config = await PricingConfig.getConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    Logger.error('Get pricing config error', { error: err.message });
    res.status(500).json({ success: false, error: { code: 'PRICING_CONFIG_ERROR', message: 'Failed to fetch pricing config' } });
  }
});

// ===== ADMIN: UPDATE PRICING CONFIG =====
router.put('/pricing-config', authenticateToken, adminAuth, auditLogger('update_pricing'), async (req, res) => {
  try {
    const { tiers, exchangeRates } = req.body;
    const updates = {};

    if (tiers) {
      // Validate tier structure
      for (const [tierName, tierData] of Object.entries(tiers)) {
        if (!['free', 'starter', 'pro'].includes(tierName)) {
          return res.status(400).json({ success: false, error: { code: 'INVALID_TIER', message: `Invalid tier: ${tierName}` } });
        }
        // Validate pricing values are non-negative
        if (tierData.monthlyUSD !== undefined && tierData.monthlyUSD < 0) {
          return res.status(400).json({ success: false, error: { code: 'INVALID_PRICE', message: 'Prices cannot be negative' } });
        }
      }
      updates.tiers = tiers;
    }

    if (exchangeRates) {
      updates.exchangeRates = { ...exchangeRates, lastUpdated: new Date() };
    }

    const config = await PricingConfig.updateConfig(updates, req.user.id);

    // ── CASCADE: propagate new limits to ALL users on the affected tier(s) ──
    // This ensures that when admin changes limits in the dashboard, every user
    // on that tier gets their user.limits updated immediately in the DB.
    if (tiers) {
      const cascadeResults = {};
      for (const [tierName, tierData] of Object.entries(tiers)) {
        if (tierData.limits && typeof tierData.limits === 'object') {
          // Build the $set object for this tier's limits
          const limitUpdates = {};
          for (const [key, val] of Object.entries(tierData.limits)) {
            limitUpdates[`limits.${key}`] = val;
          }

          // Bulk update all users on this tier
          const result = await User.updateMany(
            { subscriptionTier: tierName, isDeleted: { $ne: true } },
            { $set: limitUpdates }
          );

          cascadeResults[tierName] = result.modifiedCount;
          if (result.modifiedCount > 0) {
            Logger.info('Cascaded pricing limits to users', {
              tier: tierName,
              usersUpdated: result.modifiedCount,
              adminId: req.user.id
            });
          }
        }
      }

      Logger.info('Pricing config updated with user cascade', { adminId: req.user.id, cascade: cascadeResults });
      res.json({
        success: true,
        data: config,
        cascade: cascadeResults,
        message: 'Pricing configuration updated and applied to all users'
      });
    } else {
      Logger.info('Pricing config updated by admin', { adminId: req.user.id });
      res.json({ success: true, data: config, message: 'Pricing configuration updated successfully' });
    }
  } catch (err) {
    Logger.error('Update pricing config error', { error: err.message });
    res.status(500).json({ success: false, error: { code: 'PRICING_UPDATE_ERROR', message: 'Failed to update pricing config' } });
  }
});

// ===== ADMIN: UPDATE EXCHANGE RATES =====
router.put('/exchange-rates', authenticateToken, adminAuth, auditLogger('update_exchange_rates'), async (req, res) => {
  try {
    const { rates } = req.body;
    if (!rates || typeof rates !== 'object') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_RATES', message: 'Rates object is required' } });
    }

    const config = await PricingConfig.updateConfig({
      exchangeRates: { ...rates, lastUpdated: new Date() }
    }, req.user.id);

    Logger.info('Exchange rates updated', { adminId: req.user.id, currencies: Object.keys(rates) });
    res.json({ success: true, data: config.exchangeRates, message: 'Exchange rates updated' });
  } catch (err) {
    Logger.error('Exchange rates update error', { error: err.message });
    res.status(500).json({ success: false, error: { code: 'RATES_UPDATE_ERROR', message: 'Failed to update exchange rates' } });
  }
});

module.exports = router;