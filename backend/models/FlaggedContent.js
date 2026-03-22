const mongoose = require('mongoose');

const flaggedContentSchema = new mongoose.Schema({
  contentType: {
    type: String,
    required: true,
    enum: ['question', 'pdf', 'user', 'other']
  },
  contentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'approved', 'removed'],
    default: 'pending'
  },
  moderatorNotes: String,
  moderatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  moderatedAt: Date,
  createdAt: { type: Date, default: Date.now }
});

flaggedContentSchema.index({ status: 1, createdAt: -1 });
flaggedContentSchema.index({ contentType: 1, status: 1 });

module.exports = mongoose.model('FlaggedContent', flaggedContentSchema);