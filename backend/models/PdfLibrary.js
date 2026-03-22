const mongoose = require("mongoose");

const pdfLibrarySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  fileName: { type: String, required: true },
  s3FileKey: { type: String, default: null },
  s3BackupKey: { type: String, default: null },
  s3BundleKey: { type: String, default: null },  // ZIP bundle key for multi-file uploads
  jobId: { type: String, default: null },          // Links all files from same multi-file upload
  topic: { type: String, required: true, lowercase: true }, // Match Question schema
  numberOfQuestions: { type: Number },
  hasAnswers: { type: Boolean, default: false },
  uploadedAt: { type: Date, default: Date.now },
  
  // Multi-file coherence metadata (populated when part of multi-file upload)
  coherenceMetadata: {
    type: {
      coherenceLevel: { type: String, enum: ['all_coherent', 'partial', 'all_divergent', null] },
      overallScore: Number,
      isOutlier: Boolean,
      questionBudget: Number,
      isStyleAnchor: Boolean
    },
    default: null
  },

  // PPTX-specific metadata
  pptxMetadata: {
    type: {
      totalSlides: Number,
      totalImages: Number,
      slides: [{
        slideNumber: Number,
        text: String,
        tables: [{
          rows: [[String]]
        }]
      }]
    },
    default: null
  }
});

// Composite indexes for efficient querying and unique file tracking
pdfLibrarySchema.index({ userId: 1, topic: 1 });
// Unique per (userId, topic, fileName, jobId) — jobId distinguishes multiple
// multi-file uploads that happen to share the same topic + fileName.
pdfLibrarySchema.index(
  { userId: 1, topic: 1, fileName: 1, jobId: 1 },
  { unique: true, sparse: false }
);
pdfLibrarySchema.index({ userId: 1, s3FileKey: 1 });
pdfLibrarySchema.index({ jobId: 1 });  // Query all files in a multi-file upload

module.exports = mongoose.model("PdfLibrary", pdfLibrarySchema);
