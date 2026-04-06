const mongoose = require("mongoose");
const crypto = require("crypto");

const invitationSchema = new mongoose.Schema({
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
    index: true,
  },

  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },

  orgRole: {
    type: String,
    enum: ["org_admin", "it_admin", "teacher", "student", "guardian"],
    required: true,
  },

  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  // SHA-256 of the raw invite token — raw token sent by email, never stored
  tokenHash: {
    type: String,
    required: true,
    index: true,
  },

  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  },

  acceptedAt: {
    type: Date,
    default: null,
  },

  status: {
    type: String,
    enum: ["pending", "accepted", "expired", "revoked"],
    default: "pending",
    index: true,
  },

  // For student invites — the class they will be enrolled in on acceptance
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Classroom",
    default: null,
  },

  // 8-char alphanumeric code used for the guardian linking path
  guardianCode: {
    type: String,
    default: null,
  },

  createdAt: { type: Date, default: Date.now },
});

// Static: create an invitation with a secure random token
// Returns { invitation, rawToken } — caller is responsible for emailing rawToken
invitationSchema.statics.createInvite = async function (data) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const invitation = await this.create({ ...data, tokenHash });
  return { invitation, rawToken };
};

// Static: look up a pending (unexpired) invite by raw token
invitationSchema.statics.findByToken = function (rawToken) {
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  return this.findOne({
    tokenHash,
    status: "pending",
    expiresAt: { $gt: new Date() },
  });
};

invitationSchema.index({ orgId: 1, email: 1, status: 1 });

module.exports = mongoose.model("Invitation", invitationSchema);
