const mongoose = require('mongoose');

const backupHistorySchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['full', 'partial']
  },
  operationType: {
    type: String,
    required: true,
    enum: ['manual', 'scheduled', 'automatic'],
    default: 'manual'
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'in-progress', 'completed', 'failed']
  },
  backupKey: String,
  s3Url: String,
  fileSize: Number,
  collections: [String],
  recordCount: Number,
  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  startedAt: { type: Date, default: Date.now },
  completedAt: Date,
  errorMessage: String,
  metadata: mongoose.Schema.Types.Mixed
});

backupHistorySchema.index({ status: 1, startedAt: -1 });
backupHistorySchema.index({ type: 1, completedAt: -1 });

module.exports = mongoose.model('BackupHistory', backupHistorySchema);