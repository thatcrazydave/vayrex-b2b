/**
 * bulkInviteWorker — BullMQ worker for bulk org member invitations
 *
 * Job data: { orgId, invitedBy, invites: [{ email, orgRole, classId? }] }
 *
 * The worker processes each invite sequentially, skipping duplicates,
 * then fires sendBulkInviteStatus to the inviting admin.
 *
 * Queue name: "bulk-invites"
 * Exported: { bulkInviteQueue, bulkInviteWorker }
 */

"use strict";
const { Queue, Worker } = require("bullmq");
const { redisConnection } = require("../services/taskQueue");
const Invitation = require("../models/Invitation");
const Organization = require("../models/Organization");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const emailService = require("../services/emailService");
const Logger = require("../logger");

const QUEUE_NAME = "bulk-invites";
const VALID_ROLES = ["org_admin", "it_admin", "teacher", "student", "guardian"];

// ── Queue (used by the route to enqueue jobs) ─────────────────────────────────
const bulkInviteQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

// ── Worker (processes jobs) ────────────────────────────────────────────────────
const bulkInviteWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { orgId, invitedBy, invites } = job.data;

    Logger.info(`Bulk invite job started`, { jobId: job.id, orgId, count: invites.length });

    const org = await Organization.findById(orgId).select("name _id").lean();
    if (!org) {
      throw new Error(`Organisation ${orgId} not found — aborting bulk invite job`);
    }

    const results = { sent: [], skipped: [], failed: [] };

    for (let i = 0; i < invites.length; i++) {
      const row = invites[i];
      const email = (row.email || "").toLowerCase().trim();
      const role = row.orgRole;

      // Basic validation
      if (!email || !VALID_ROLES.includes(role)) {
        results.failed.push({ email, reason: "invalid_data" });
        continue;
      }

      try {
        // Skip if active invite already exists
        const existing = await Invitation.findOne({
          orgId,
          email,
          status: "pending",
          expiresAt: { $gt: new Date() },
        }).lean();

        if (existing) {
          results.skipped.push({ email, reason: "active_invite_exists" });
          continue;
        }

        const { invitation, rawToken } = await Invitation.createInvite({
          orgId,
          email,
          orgRole: role,
          invitedBy,
          classId: row.classId || null,
        });

        invitation.rawToken = rawToken;

        await emailService.sendInvitationEmail(invitation, org);

        results.sent.push({ email, role });

        // Update job progress so the frontend progress bar works
        await job.updateProgress(Math.round(((i + 1) / invites.length) * 100));
      } catch (err) {
        Logger.error("Bulk invite row failed", { email, error: err.message });
        results.failed.push({ email, reason: err.message });
      }
    }

    // Notify the admin who triggered the bulk invite
    const admin = await User.findById(invitedBy).select("email username").lean();
    if (admin) {
      emailService
        .sendBulkInviteStatus(admin.email, admin.username, org.name, results)
        .catch((e) => {
          Logger.error("sendBulkInviteStatus failed (non-fatal)", { error: e.message });
        });
    }

    AuditLog.create({
      userId: invitedBy,
      action: "org_member_invited",
      orgId,
      details: {
        type: "bulk",
        sent: results.sent.length,
        skipped: results.skipped.length,
        failed: results.failed.length,
      },
    }).catch(() => {});

    Logger.info("Bulk invite job complete", {
      jobId: job.id,
      orgId,
      sent: results.sent.length,
      skipped: results.skipped.length,
      failed: results.failed.length,
    });

    return results;
  },
  {
    connection: redisConnection,
    concurrency: 2,
    lockDuration: 5 * 60 * 1000, // 5 min — email SMTP may be slow
  },
);

bulkInviteWorker.on("completed", (job, result) => {
  Logger.info(`Bulk invite job ${job.id} completed`, {
    sent: result?.sent?.length,
    failed: result?.failed?.length,
  });
});

bulkInviteWorker.on("failed", (job, err) => {
  Logger.error(`Bulk invite job ${job?.id} failed`, { error: err.message });
});

module.exports = { bulkInviteQueue, bulkInviteWorker };
