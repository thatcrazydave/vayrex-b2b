const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  action: {
    type: String,
    required: true,
  enum: [
    'user_created', 'user_updated', 'user_deleted', 'user_role_changed',
    'user_status_changed', 'question_uploaded', 'question_deleted',
    'exam_taken', 'contact_created', 'contact_updated',
    'backup_created', 'backup_restored', 'settings_updated',
    'login', 'logout', 'failed_login',
    'admin_access_success', 'admin_access_denied'
  ]
  },
  targetType: String,
  targetId: mongoose.Schema.Types.ObjectId,
  details: mongoose.Schema.Types.Mixed,
  ipAddress: String,
  userAgent: String,
  severity: {
    type: String,
    enum: ['info', 'warning', 'error', 'critical'],
    default: 'info'
  },
  createdAt: { type: Date, default: Date.now }
});

auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);