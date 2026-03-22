const mongoose = require('mongoose');

// ─── Message sub-schema ───
const threadMessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 20000
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// ─── ChatThread document ───
const chatThreadSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SummarySession',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Title auto-set from the first user message (45-char truncation)
  title: {
    type: String,
    default: 'New Chat',
    maxlength: 100,
    trim: true
  },

  // Ordered message history for this thread
  messages: {
    type: [threadMessageSchema],
    default: []
  },

  // Max messages to keep per thread (rolling window — oldest dropped after this)
  maxMessages: {
    type: Number,
    default: 200
  }
}, {
  timestamps: true   // createdAt + updatedAt
});

// ═══ INDEXES ═══
// Primary lookup: all threads for a session, newest first
chatThreadSchema.index({ sessionId: 1, createdAt: -1 });
// Ownership guard queries
chatThreadSchema.index({ userId: 1, sessionId: 1 });

// ═══ STATICS ═══

/**
 * List threads for a session (no messages — just metadata for the sidebar).
 */
chatThreadSchema.statics.listForSession = function (sessionId, userId) {
  return this.find(
    { sessionId, userId },
    { messages: 0 }  // exclude messages from listing — load on demand
  )
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Enforce per-session thread cap: delete oldest threads beyond maxThreads.
 */
chatThreadSchema.statics.enforceThreadLimit = async function (sessionId, userId, maxThreads = 20) {
  const count = await this.countDocuments({ sessionId, userId });
  if (count <= maxThreads) return 0;
  const toDelete = await this.find({ sessionId, userId })
    .sort({ createdAt: 1 })
    .limit(count - maxThreads)
    .select('_id')
    .lean();
  if (!toDelete.length) return 0;
  await this.deleteMany({ _id: { $in: toDelete.map(d => d._id) } });
  return toDelete.length;
};

module.exports = mongoose.model('ChatThread', chatThreadSchema);
