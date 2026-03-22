const mongoose = require('mongoose');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const BackupHistory = require('../models/BackupHistory');
const Logger = require('../logger');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class BackupService {
  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
    this.bucket = process.env.S3_BUCKET_NAME || 'vayrex-backups';
  }

  /**
   * Validate S3 connection and credentials
   */
  async validateS3Connection() {
    try {
      if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY || !this.bucket) {
        Logger.warn('AWS credentials not fully configured');
        return false;
      }
      Logger.info('S3 connection validated');
      return true;
    } catch (err) {
      Logger.error('S3 validation failed', { error: err.message });
      return false;
    }
  }

  /**
   * Create full backup of all collections
   */
  async createFullBackup(initiatedBy = null, type = 'manual') {
    const backupRecord = await BackupHistory.create({
      type: 'full',
      operationType: type,
      status: 'in-progress',
      initiatedBy,
      collections: [],
      createdBy: initiatedBy
    });

    try {
      Logger.info('Starting full backup', { backupId: backupRecord._id });

      // Collection names - fixed typo from pdflibraries to pdflibrary
      const collections = ['users', 'questions', 'results', 'pdflibrary', 'contacts'];
      const backupData = {};
      let totalRecords = 0;

      for (const collectionName of collections) {
        try {
          const collection = mongoose.connection.collection(collectionName);
          const data = await collection.find({}).toArray();

          // Remove sensitive data from users
          if (collectionName === 'users') {
            data.forEach(user => {
              delete user.password;
              delete user.refreshToken;
              delete user.__v;
            });
          }

          backupData[collectionName] = data;
          totalRecords += data.length;
          Logger.info(`Backed up ${collectionName}`, { count: data.length });
        } catch (collErr) {
          Logger.warn(`Failed to backup ${collectionName}`, { error: collErr.message });
          backupData[collectionName] = [];
        }
      }

      // Create metadata
      const metadata = {
        type: 'full',
        version: '1.0',
        timestamp: new Date().toISOString(),
        totalRecords,
        collections: Object.keys(backupData),
        nodeVersion: process.version,
        mongodbUri: process.env.MONGODB_URI ? 'configured' : 'not-configured'
      };

      // Combine data with metadata
      const backupPayload = {
        metadata,
        data: backupData
      };

      // Compress backup
      const jsonData = JSON.stringify(backupPayload);
      const compressed = await gzip(jsonData);

      // Upload to S3
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupKey = `system_backups/full_backup_${timestamp}_${backupRecord._id}.json.gz`;

      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: backupKey,
        Body: compressed,
        ContentType: 'application/gzip',
        ServerSideEncryption: 'AES256',
        Metadata: {
          'backup-type': 'full',
          'backup-id': backupRecord._id.toString(),
          'timestamp': timestamp,
          'record-count': totalRecords.toString(),
          'collections': collections.join(',')
        }
      }));

      // Update backup record
      const updatedBackup = await BackupHistory.findByIdAndUpdate(backupRecord._id, {
        status: 'completed',
        backupKey,
        s3Url: `https://${this.bucket}.s3.amazonaws.com/${backupKey}`,
        fileSize: compressed.length,
        collections,
        recordCount: totalRecords,
        completedAt: new Date(),
        metadata: {
          collections,
          totalRecords,
          compressed: true,
          originalSize: jsonData.length
        }
      }, { new: true }).populate('initiatedBy', 'username email');

      Logger.info('Full backup completed', {
        backupId: backupRecord._id,
        recordCount: totalRecords,
        fileSize: compressed.length,
        compressionRatio: ((1 - compressed.length / jsonData.length) * 100).toFixed(2) + '%'
      });

      return updatedBackup;

    } catch (err) {
      Logger.error('Backup failed', {
        backupId: backupRecord._id,
        error: err.message,
        stack: err.stack
      });

      await BackupHistory.findByIdAndUpdate(backupRecord._id, {
        status: 'failed',
        errorMessage: err.message,
        failedAt: new Date()
      });

      // Create alert for failed backup
      try {
        const AlertService = require('./alertService');
        await AlertService.createAlert(
          'error',
          'critical',
          'backup',
          `System backup failed: ${err.message}`,
          { backupId: backupRecord._id.toString(), error: err.message }
        );
      } catch (alertErr) {
        Logger.warn('Failed to create alert for backup failure', { error: alertErr.message });
      }

      throw err;
    }
  }

  /**
   * Create partial backup of selected collections
   */
  async createPartialBackup(collections = [], initiatedBy = null, type = 'manual') {
    if (!Array.isArray(collections) || collections.length === 0) {
      throw new Error('At least one collection must be selected for partial backup');
    }

    const backupRecord = await BackupHistory.create({
      type: 'partial',
      operationType: type,
      status: 'in-progress',
      initiatedBy,
      collections,
      createdBy: initiatedBy
    });

    try {
      Logger.info('Starting partial backup', {
        backupId: backupRecord._id,
        collections: collections
      });

      const backupData = {};
      let totalRecords = 0;

      // Validate collection names
      const validCollections = ['users', 'questions', 'results', 'pdflibrary', 'contacts'];
      const invalidCollections = collections.filter(c => !validCollections.includes(c));

      if (invalidCollections.length > 0) {
        throw new Error(`Invalid collection names: ${invalidCollections.join(', ')}`);
      }

      for (const collectionName of collections) {
        try {
          const collection = mongoose.connection.collection(collectionName);
          const data = await collection.find({}).toArray();

          // Remove sensitive data from users
          if (collectionName === 'users') {
            data.forEach(user => {
              delete user.password;
              delete user.refreshToken;
              delete user.__v;
            });
          }

          backupData[collectionName] = data;
          totalRecords += data.length;
          Logger.info(`Backed up ${collectionName}`, { count: data.length });
        } catch (collErr) {
          Logger.warn(`Failed to backup ${collectionName}`, { error: collErr.message });
          backupData[collectionName] = [];
        }
      }

      // Create metadata
      const metadata = {
        type: 'partial',
        version: '1.0',
        timestamp: new Date().toISOString(),
        totalRecords,
        collections: collections,
        nodeVersion: process.version
      };

      // Combine data with metadata
      const backupPayload = {
        metadata,
        data: backupData
      };

      // Compress backup
      const jsonData = JSON.stringify(backupPayload);
      const compressed = await gzip(jsonData);

      // Upload to S3
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupKey = `system_backups/partial_backup_${timestamp}_${backupRecord._id}.json.gz`;

      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: backupKey,
        Body: compressed,
        ContentType: 'application/gzip',
        ServerSideEncryption: 'AES256',
        Metadata: {
          'backup-type': 'partial',
          'backup-id': backupRecord._id.toString(),
          'timestamp': timestamp,
          'record-count': totalRecords.toString(),
          'collections': collections.join(',')
        }
      }));

      // Update backup record
      const updatedBackup = await BackupHistory.findByIdAndUpdate(backupRecord._id, {
        status: 'completed',
        backupKey,
        s3Url: `https://${this.bucket}.s3.amazonaws.com/${backupKey}`,
        fileSize: compressed.length,
        collections,
        recordCount: totalRecords,
        completedAt: new Date(),
        metadata: {
          collections,
          totalRecords,
          compressed: true,
          originalSize: jsonData.length
        }
      }, { new: true }).populate('initiatedBy', 'username email');

      Logger.info('Partial backup completed', {
        backupId: backupRecord._id,
        recordCount: totalRecords,
        fileSize: compressed.length,
        collections,
        compressionRatio: ((1 - compressed.length / jsonData.length) * 100).toFixed(2) + '%'
      });

      return updatedBackup;

    } catch (err) {
      Logger.error('Partial backup failed', {
        backupId: backupRecord._id,
        error: err.message,
        stack: err.stack
      });

      await BackupHistory.findByIdAndUpdate(backupRecord._id, {
        status: 'failed',
        errorMessage: err.message,
        failedAt: new Date()
      });

      throw err;
    }
  }

  /**
   * Restore backup from S3
   */
  async restoreBackup(backupId, userId) {
    const backup = await BackupHistory.findById(backupId);

    if (!backup) {
      throw new Error('Backup not found');
    }

    if (backup.status !== 'completed') {
      throw new Error(`Cannot restore backup with status: ${backup.status}`);
    }

    if (!backup.backupKey) {
      throw new Error('Backup S3 key is missing');
    }

    // Update status to restoring
    await BackupHistory.findByIdAndUpdate(backupId, {
      status: 'restoring',
      restoredBy: userId
    });

    try {
      Logger.info('Starting backup restore', {
        backupId,
        userId,
        backupKey: backup.backupKey
      });

      // Download from S3
      const getObjectResponse = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: backup.backupKey
      }));

      // Convert stream to buffer
      const chunks = [];
      for await (const chunk of getObjectResponse.Body) {
        chunks.push(chunk);
      }
      const compressedData = Buffer.concat(chunks);

      Logger.info('Backup downloaded from S3', {
        backupId,
        size: compressedData.length
      });

      // Decompress
      const decompressed = await gunzip(compressedData);
      const backupPayload = JSON.parse(decompressed.toString());

      const { metadata, data } = backupPayload;

      // Validate backup structure
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid backup structure');
      }

      if (!metadata || !Array.isArray(metadata.collections)) {
        throw new Error('Invalid backup metadata');
      }

      Logger.info('Backup decompressed and validated', {
        backupId,
        collections: metadata.collections,
        recordCount: metadata.totalRecords
      });

      // Restore collections
      let restoredRecords = 0;
      const restoreResults = {};

      for (const collectionName of metadata.collections) {
        try {
          const collection = mongoose.connection.collection(collectionName);
          const collectionData = data[collectionName];

          if (!Array.isArray(collectionData) || collectionData.length === 0) {
            Logger.info(`Skipping empty collection: ${collectionName}`);
            restoreResults[collectionName] = { status: 'skipped', count: 0 };
            continue;
          }

          // Clear existing data
          const deleteResult = await collection.deleteMany({});
          Logger.info(`Cleared ${collectionName}`, { deleted: deleteResult.deletedCount });

          // Insert backup data
          const insertResult = await collection.insertMany(collectionData, { ordered: false });
          const insertedCount = insertResult.insertedIds.length;
          restoredRecords += insertedCount;

          restoreResults[collectionName] = {
            status: 'restored',
            count: insertedCount
          };

          Logger.info(`Restored ${collectionName}`, {
            inserted: insertedCount
          });
        } catch (restoreErr) {
          Logger.error(`Failed to restore ${collectionName}`, {
            error: restoreErr.message
          });
          restoreResults[collectionName] = {
            status: 'failed',
            error: restoreErr.message
          };
          // Continue with other collections instead of throwing
        }
      }

      // Update backup record
      const updatedBackup = await BackupHistory.findByIdAndUpdate(
        backupId,
        {
          status: 'restored',
          restoredBy: userId,
          restoredAt: new Date(),
          recordCount: restoredRecords,
          restoreMetadata: {
            results: restoreResults,
            totalRestored: restoredRecords
          }
        },
        { new: true }
      ).populate('initiatedBy', 'username email').populate('restoredBy', 'username email');

      Logger.info('Backup restore completed', {
        backupId,
        restoredRecords,
        restoredBy: userId,
        results: restoreResults
      });

      // Create alert for successful restore
      try {
        const AlertService = require('./alertService');
        await AlertService.createAlert(
          'info',
          'medium',
          'backup',
          `Backup ${backup._id} has been successfully restored. ${restoredRecords} records restored.`,
          { backupId: backup._id.toString(), recordsRestored: restoredRecords, restoredBy: userId }
        );
      } catch (alertErr) {
        Logger.warn('Failed to create alert for backup restore', { error: alertErr.message });
      }

      return updatedBackup;

    } catch (err) {
      Logger.error('Backup restore failed', {
        backupId,
        error: err.message,
        stack: err.stack
      });

      await BackupHistory.findByIdAndUpdate(backupId, {
        status: 'failed',
        errorMessage: `Restore failed: ${err.message}`,
        failedAt: new Date()
      });

      throw err;
    }
  }

  /**
   * Delete backup from S3 and database
   */
  async deleteBackup(backupId, userId) {
    const backup = await BackupHistory.findById(backupId);

    if (!backup) {
      throw new Error('Backup not found');
    }

    try {
      Logger.info('Starting backup deletion', {
        backupId,
        userId,
        s3Key: backup.backupKey
      });

      // Delete from S3
      if (backup.backupKey) {
        await this.s3Client.send(new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: backup.backupKey
        }));

        Logger.info('Backup deleted from S3', {
          backupId,
          key: backup.backupKey
        });
      }

      // Delete from database
      await BackupHistory.findByIdAndDelete(backupId);

      Logger.info('Backup deleted from database', {
        backupId,
        deletedBy: userId
      });

      return { success: true, backupId };

    } catch (err) {
      Logger.error('Backup deletion error', {
        backupId,
        error: err.message,
        stack: err.stack
      });
      throw err;
    }
  }

  /**
   * Get backup statistics
   */
  async getBackupStats() {
    try {
      const backups = await BackupHistory.find().sort({ startedAt: -1 }).lean();

      if (backups.length === 0) {
        return {
          total: 0,
          totalSize: 0,
          byStatus: {},
          byType: {},
          latest: null
        };
      }

      const stats = {
        total: backups.length,
        totalSize: backups.reduce((sum, b) => sum + (b.fileSize || 0), 0),
        byStatus: {},
        byType: {},
        latest: backups[0], // Already sorted, so first one is latest
        oldestCompleted: null
      };

      backups.forEach(backup => {
        // Count by status
        stats.byStatus[backup.status] = (stats.byStatus[backup.status] || 0) + 1;

        // Count by type
        stats.byType[backup.type] = (stats.byType[backup.type] || 0) + 1;

        // Find oldest completed backup
        if (backup.status === 'completed' && (!stats.oldestCompleted || backup.completedAt < stats.oldestCompleted.completedAt)) {
          stats.oldestCompleted = backup;
        }
      });

      return stats;
    } catch (err) {
      Logger.error('Failed to get backup stats', { error: err.message });
      return {
        total: 0,
        totalSize: 0,
        byStatus: {},
        byType: {},
        latest: null
      };
    }
  }

  /**
   * Get backup history with pagination
   */
  async getBackupHistory(limit = 50, skip = 0) {
    try {
      const backups = await BackupHistory.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('initiatedBy', 'username email')
        .populate('createdBy', 'username email')
        .populate('restoredBy', 'username email')
        .lean();

      return backups || [];
    } catch (err) {
      Logger.error('Failed to get backup history', { error: err.message });
      return [];
    }
  }

  /**
   * Delete backups older than specified days
   */
  async deleteOldBackups(daysToKeep = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const oldBackups = await BackupHistory.find({
        completedAt: { $lt: cutoffDate },
        status: 'completed'
      });

      Logger.info('Found old backups for deletion', {
        count: oldBackups.length,
        cutoffDate
      });

      let deletedCount = 0;
      const errors = [];

      for (const backup of oldBackups) {
        try {
          await this.deleteBackup(backup._id);
          deletedCount++;
        } catch (err) {
          Logger.warn('Failed to delete old backup', {
            backupId: backup._id,
            error: err.message
          });
          errors.push({
            backupId: backup._id.toString(),
            error: err.message
          });
        }
      }

      Logger.info('Old backups cleanup completed', {
        deletedCount,
        failedCount: errors.length,
        errors: errors.length > 0 ? errors : undefined
      });

      return { deletedCount, failedCount: errors.length };

    } catch (err) {
      Logger.error('Backup cleanup error', { error: err.message });
      throw err;
    }
  }

  /**
   * Schedule automatic backups
   */
  async scheduleBackups() {
    try {
      // Calculate time until next 2 AM
      const now = new Date();
      const scheduledTime = new Date();
      scheduledTime.setHours(2, 0, 0, 0);

      if (scheduledTime <= now) {
        scheduledTime.setDate(scheduledTime.getDate() + 1);
      }

      const timeUntilBackup = scheduledTime - now;

      Logger.info('Next backup scheduled', {
        scheduledTime: scheduledTime.toISOString(),
        hoursUntilBackup: (timeUntilBackup / (1000 * 60 * 60)).toFixed(2)
      });

      setTimeout(() => {
        this.createFullBackup(null, 'scheduled')
          .then((backup) => {
            Logger.info('Scheduled backup completed', { backupId: backup._id });
            // Schedule next backup
            this.scheduleBackups();
          })
          .catch((err) => {
            Logger.error('Scheduled backup error', { error: err.message });
            // Retry scheduling in 1 hour
            setTimeout(() => this.scheduleBackups(), 60 * 60 * 1000);
          });
      }, timeUntilBackup);

    } catch (err) {
      Logger.error('Backup scheduling error', { error: err.message });
    }
  }
}

// Initialize service
const backupService = new BackupService();

// Start scheduled backups
backupService.scheduleBackups();

// Setup weekly cleanup of old backups
setInterval(() => {
  backupService.deleteOldBackups(30)
    .catch(err => Logger.error('Backup cleanup failed', { error: err.message }));
}, 7 * 24 * 60 * 60 * 1000);

Logger.info('Backup service initialized');

module.exports = backupService;