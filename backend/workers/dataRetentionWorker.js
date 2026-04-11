const Organization = require("../models/Organization");
const Term = require("../models/Term");
const GradeBook = require("../models/GradeBook");
const Assignment = require("../models/Assignment");
const Submission = require("../models/Submission");
const AttendanceRecord = require("../models/AttendanceRecord");
const ReportCard = require("../models/ReportCard");
const AuditLog = require("../models/AuditLog");
const storageService = require("../services/storageService");
const Logger = require("../logger");

/**
 * Purge archived MongoDB records for terms past the retention window.
 *
 * Safety checks before purging:
 * 1. Term is marked isClosed + archiveS3Key is set
 * 2. Storage object actually exists (verified before deletion)
 * 3. Term is older than the org's retention window
 *
 * @param {boolean} dryRun - If true, log what would be purged but don't delete
 */
async function runRetentionPurge(dryRun = false) {
  Logger.info(`Data retention purge starting (dryRun: ${dryRun})`);

  const orgs = await Organization.find({ isActive: true }).select("_id settings").lean();

  for (const org of orgs) {
    const retentionTerms = org.settings?.dataRetentionTerms || 3;

    const allClosedTerms = await Term.find({
      orgId: org._id,
      isClosed: true,
      archiveS3Key: { $exists: true, $ne: null },
    })
      .sort({ archivedAt: -1 })
      .lean();

    const termsToPurge = allClosedTerms.slice(retentionTerms);

    for (const term of termsToPurge) {
      // Safety: verify storage archive exists before deleting MongoDB data
      let archiveExists = false;
      try {
        // Use list to check existence without downloading the whole file
        const lastSlash = term.archiveS3Key.lastIndexOf("/");
        const dir = lastSlash >= 0 ? term.archiveS3Key.substring(0, lastSlash) : "";
        const filename =
          lastSlash >= 0 ? term.archiveS3Key.substring(lastSlash + 1) : term.archiveS3Key;
        const files = await storageService.list(dir, org._id, { limit: 200 });
        archiveExists = files.some((f) => f.name === filename);
      } catch (err) {
        Logger.error("SKIP PURGE: Storage check failed", {
          orgId: org._id,
          termId: term._id,
          error: err.message,
        });
        continue;
      }

      if (!archiveExists) {
        Logger.error(
          "SKIP PURGE: Storage archive not found — refusing to delete MongoDB data",
          {
            orgId: org._id,
            termId: term._id,
            archiveKey: term.archiveS3Key,
          },
        );
        continue;
      }

      if (dryRun) {
        Logger.info("DRY RUN: would purge term", {
          orgId: org._id,
          termId: term._id,
          termName: term.name,
          archivedAt: term.archivedAt,
        });
        continue;
      }

      const assignmentIds = (
        await Assignment.find({ orgId: org._id, termId: term._id }).select("_id").lean()
      ).map((a) => a._id);

      const results = await Promise.all([
        GradeBook.deleteMany({ orgId: org._id, termId: term._id, isArchived: true }),
        Assignment.deleteMany({ orgId: org._id, termId: term._id, isArchived: true }),
        assignmentIds.length > 0
          ? Submission.deleteMany({
              orgId: org._id,
              assignmentId: { $in: assignmentIds },
              isArchived: true,
            })
          : Promise.resolve({ deletedCount: 0 }),
        AttendanceRecord.deleteMany({ orgId: org._id, termId: term._id, isArchived: true }),
        ReportCard.deleteMany({ orgId: org._id, termId: term._id, isArchived: true }),
      ]);

      const totalDeleted = results.reduce((sum, r) => sum + (r.deletedCount || 0), 0);

      Logger.info("Term data purged from MongoDB", {
        orgId: org._id,
        termId: term._id,
        totalDeleted,
        archiveKey: term.archiveS3Key,
      });

      await AuditLog.create({
        userId: null,
        action: "term_closed",
        orgId: org._id,
        targetType: "Term",
        targetId: term._id,
        details: {
          subAction: "retention_purge",
          totalDeleted,
          archiveKey: term.archiveS3Key,
        },
        severity: "critical",
      });
    }
  }

  Logger.info("Data retention purge complete");
}

module.exports = { runRetentionPurge };
