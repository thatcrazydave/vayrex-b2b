const mongoose = require('mongoose');

const systemAlertSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: [
      'error', 'warning', 'info', 'critical',
      'service_down', 'performance', 'api', 'queue',
      'scheduled_task_failed', 'subscriptions_expired'
    ]
  },
  severity: {
    type: String,
    required: true,
    enum: ['low', 'medium', 'high', 'critical']
  },
  service: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  details: mongoose.Schema.Types.Mixed,
  status: {
    type: String,
    enum: ['active', 'acknowledged', 'resolved'],
    default: 'active'
  },
  resolution: String,
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  resolvedAt: Date,
  createdAt: { type: Date, default: Date.now }
});

systemAlertSchema.index({ status: 1, severity: 1, createdAt: -1 });
systemAlertSchema.index({ service: 1, createdAt: -1 });

module.exports = mongoose.model('SystemAlert', systemAlertSchema);