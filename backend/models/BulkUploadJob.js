const mongoose = require('mongoose');

const bulkUploadJobSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  topic: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'partial'],
    default: 'pending',
    index: true
  },
  totalFiles: {
    type: Number,
    required: true
  },
  processedFiles: {
    type: Number,
    default: 0
  },
  totalQuestionsGenerated: {
    type: Number,
    default: 0
  },
  files: [{
    fileName: String,
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    },
    questionsGenerated: { type: Number, default: 0 },
    error: String,
    s3FileKey: String,
    processedAt: Date
  }],
  error: String,
  startedAt: Date,
  completedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Auto-expire old jobs after 30 days
bulkUploadJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('BulkUploadJob', bulkUploadJobSchema);
