const mongoose = require('mongoose');

// ─── Chat message sub-schema ───
const chatMessageSchema = new mongoose.Schema({
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

// ─── Core teaching section ───
const sectionSchema = new mongoose.Schema({
  sectionTitle: { type: String, default: '' },
  content:      { type: String, default: '' }
}, { _id: false });

// ─── Sub-chapter sub-schema (course outline sessions) ───
const subChapterSchema = new mongoose.Schema({
  number:  { type: String, default: '' },   // e.g. "1.1", "3.2"
  title:   { type: String, default: '' },   // sub-topic name
  content: { type: String, default: '' },   // markdown content
  status:  { type: String, enum: ['generating', 'complete', 'failed'], default: 'generating' }
}, { _id: false });

// ─── Image reference sub-schema (lightweight metadata, no buffers) ───
const imageRefSchema = new mongoose.Schema({
  name:           { type: String, default: '' },
  type:           { type: String, default: '' },
  position:       { type: Number, default: 0 },     // slide number, page number, or paragraph index
  totalPositions: { type: Number, default: 0 },     // total slides, pages, or paragraphs
  sourceFormat:   { type: String, default: '' }      // 'pptx', 'pdf', 'docx', 'image'
}, { _id: false });

// ─── Chapter sub-schema (mirrors frontend courseData.chapters[]) ───
const chapterSchema = new mongoose.Schema({
  id:             { type: Number, required: true },
  title:          { type: String, default: '' },
  hook:           { type: String, default: '' },
  coreTeaching:   { type: [sectionSchema], default: [] },
  keyTakeaways:   { type: [String], default: [] },
  notes:          { type: String, default: '' },
  // ── Image references for PDF export re-extraction ──
  imageRefs:      { type: [imageRefSchema], default: [] },
  // ── Course outline fields (only used when sessionType === 'course_outline') ──
  overview:       { type: String, default: '' },
  subChapters:    { type: [subChapterSchema], default: [] }
}, { _id: false });

// ─── Main SummarySession document ───
const summarySessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // ── Session type: 'file_summary' (default) or 'course_outline' ──
  sessionType: {
    type: String,
    enum: ['file_summary', 'course_outline'],
    default: 'file_summary',
    index: true
  },

  // ── Source file info ──
  sourceFileName: {
    type: String,
    required: true,
    trim: true
  },
  sourceFileHash: {
    type: String,
    required: true,
    index: true
  },
  sourceFileSize: {
    type: Number,
    default: 0
  },
  s3Key: {
    type: String,
    default: null
  },

  // ── Course outline specific fields ──
  courseName: {
    type: String,
    default: null,
    trim: true
  },
  depthTier: {
    type: String,
    enum: ['full', 'standard', 'condensed', null],
    default: null
  },

  // ── Course data (what the frontend renders) ──
  title: {
    type: String,
    default: 'Untitled Summary'
  },
  chapters: {
    type: [chapterSchema],
    default: []
  },

  // ── Processing status ──
  status: {
    type: String,
    enum: ['streaming', 'complete', 'partial', 'failed'],
    default: 'streaming',
    index: true
  },
  totalExpectedChunks: {
    type: Number,
    default: 0
  },

  // ── Chat history ──
  chatHistory: {
    type: [chatMessageSchema],
    default: []
  },

  // ── User position (restore exact view on resume) ──
  lastChapterIdx: {
    type: Number,
    default: 0
  },
  lastTab: {
    type: String,
    enum: ['lesson', 'notes', 'podcast', 'subchapter'],
    default: 'lesson'
  },
  lastSubChapterNum: {
    type: String,
    default: null
  },

  // ── Highlights / annotations ──
  highlights: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // ── Per-chapter notes typed by the user ──
  userNotes: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // ── Active chat thread (which thread is open in the tutor panel) ──
  activeChatThreadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatThread',
    default: null
  }
}, {
  timestamps: true  // createdAt + updatedAt
});

// ═══ INDEXES ═══
// Fast lookup: user's sessions sorted newest first
summarySessionSchema.index({ userId: 1, createdAt: -1 });
// Dedup lookup: same user + same file content
summarySessionSchema.index({ userId: 1, sourceFileHash: 1 });
// Cleanup: find old/stale streaming sessions
summarySessionSchema.index({ status: 1, updatedAt: 1 });

// ═══ STATICS ═══

/**
 * Get a user's recent sessions (for the history list).
 * @param {ObjectId} userId
 * @param {number} limit – max sessions to return (default 20)
 */
summarySessionSchema.statics.getUserSessions = function (userId, limit = 20) {
  return this.find(
    { userId },
    { chatHistory: 0, highlights: 0 }  // exclude heavy fields from listing
  )
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
};

/**
 * Find an existing completed/partial session for the same file.
 * @param {ObjectId} userId
 * @param {string} fileHash
 */
summarySessionSchema.statics.findByFileHash = function (userId, fileHash) {
  return this.findOne(
    { userId, sourceFileHash: fileHash, status: { $in: ['complete', 'partial', 'streaming'] } },
    { chatHistory: 0, highlights: 0 }
  )
    .sort({ updatedAt: -1 })
    .lean();
};

/**
 * Enforce per-user session cap: delete oldest sessions beyond the limit.
 * @param {ObjectId} userId
 * @param {number} maxSessions – default 20
 */
summarySessionSchema.statics.enforceSessionLimit = async function (userId, maxSessions = 20) {
  const count = await this.countDocuments({ userId });
  if (count <= maxSessions) return 0;
  const toDelete = await this.find({ userId })
    .sort({ updatedAt: 1 })
    .limit(count - maxSessions)
    .select('_id')
    .lean();
  if (toDelete.length === 0) return 0;
  const ids = toDelete.map(d => d._id);
  const result = await this.deleteMany({ _id: { $in: ids } });
  return result.deletedCount || 0;
};

const SummarySession = mongoose.models.SummarySession || mongoose.model('SummarySession', summarySessionSchema);
module.exports = SummarySession;
