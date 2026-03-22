// models/Contact.js
const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  ticketId: {
    type: String,
    unique: true,
    required: true
  },
  name: { type: String, required: true },
  email: { type: String, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  status: {
    type: String,
    enum: ['new', 'in-progress', 'resolved', 'closed'],
    default: 'new'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  category: {
    type: String,
    enum: ['bug', 'feature', 'question', 'complaint', 'other'],
    default: 'other'
  },
  adminNotes: String,
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  resolvedAt: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Index for ticket lookup (ticketId already indexed via unique: true, createdAt via timestamps)
contactSchema.index({ status: 1, priority: -1 });
contactSchema.index({ email: 1 });

/**
 * Generate unique ticket ID
 * Format: TKT-YYYYMMDD-XXXX (e.g., TKT-20260204-A1B2)
 */
contactSchema.statics.generateTicketId = async function() {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  
  // Generate random alphanumeric suffix
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  const ticketId = `TKT-${dateStr}-${suffix}`;
  
  // Check if ticket ID already exists (very unlikely but handle it)
  const exists = await this.findOne({ ticketId });
  if (exists) {
    return this.generateTicketId(); // Recursively try again
  }
  
  return ticketId;
};

module.exports = mongoose.model('Contact', contactSchema);
