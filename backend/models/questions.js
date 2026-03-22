const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  topic: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },

  questionNumber: {
    type: String,
    default: '1'
  },

  subPart: {
    type: String,
    default: null
  },

  questionText: {
    type: String,
    required: true,
    trim: true,
    minlength: 10,
    maxlength: 2000
  },

  questionType: {
    type: String,
    enum: ['multiple-choice', 'true-false', 'essay', 'fill-in-blank', 'theory'],
    default: 'multiple-choice'
  },

  options: {
    type: [String],
    default: []
  },

  correctAnswer: {
    type: Number,
    default: null
  },

  // For fill-in-blank questions — the expected blank answer
  blankAnswer: {
    type: String,
    default: null,
    trim: true,
    maxlength: 500
  },

  // For theory / essay questions — the model answer
  modelAnswer: {
    type: String,
    default: null,
    trim: true,
    maxlength: 3000
  },

  explanation: {
    type: String,
    default: '',
    maxlength: 1000
  },

  // Source session for summary-generated quizzes
  summarySessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SummarySession',
    default: null
  },

  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'unknown'],
    default: 'medium',
    lowercase: true
  },

  batchId: {
    type: String,
    default: null
  },

  sourceFile: {
    type: String,
    default: 'Unknown'
  }
}, {
  timestamps: true
});
// ═════ INDEXES ═════
questionSchema.index({ userId: 1, topic: 1 });
// createdAt index is automatically created by timestamps: true

// ═════ PRE-SAVE ═════
questionSchema.pre('save', function(next) {
  if (this.correctAnswer !== null && this.options.length > 0) {
    if (this.correctAnswer < 0 || this.correctAnswer >= this.options.length) {
      this.correctAnswer = null;
    }
  }
  next();
});

// ═════ STATIC METHOD ═════
questionSchema.statics.findRandomQuestions = async function(userId, topic, limit = 10) {
  return this.aggregate([
    { $match: { userId, topic } },
    { $sample: { size: limit } }
  ]);
};

module.exports = mongoose.model('Question', questionSchema);
