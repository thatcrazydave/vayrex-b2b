const mongoose = require("mongoose");

const answerSubSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "Question" },
    questionText: { type: String, required: true },
    questionType: { type: String, default: 'multiple-choice' },
    selectedIndex: { type: Number, default: null },
    selectedText: { type: String, default: null },
    correctIndex: { type: Number, default: null },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: false }
);

const resultSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    topic: { type: String, required: true },
    totalQuestions: { type: Number, required: true },
    correctCount: { type: Number, required: true },
    percentage: { type: Number, required: true },
    jobId: { type: String, index: true },
    timeSpentSeconds: { type: Number, default: 0 },
    mode: { type: String, enum: ['exam', 'practice'], default: 'exam' },
    answers: [answerSubSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Result", resultSchema);
