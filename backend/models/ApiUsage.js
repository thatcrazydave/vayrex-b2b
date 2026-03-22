const mongoose = require('mongoose');

const apiUsageSchema = new mongoose.Schema({
  endpoint: {
    type: String,
    required: true
  },
  method: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  statusCode: Number,
  responseTime: Number,
  requestSize: Number,
  responseSize: Number,
  userAgent: String,
  ipAddress: String,
  timestamp: { type: Date, default: Date.now }
});

apiUsageSchema.index({ endpoint: 1, timestamp: -1 });
apiUsageSchema.index({ userId: 1, timestamp: -1 });
apiUsageSchema.index({ timestamp: -1 });

module.exports = mongoose.model('ApiUsage', apiUsageSchema);