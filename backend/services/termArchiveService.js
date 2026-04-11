const zlib = require("zlib");
const { promisify } = require("util");
const gzip = promisify(zlib.gzip);

const GradeBook = require("../models/GradeBook");
const Assignment = require("../models/Assignment");
const Submission = require("../models/Submission");
const AttendanceRecord = require("../models/AttendanceRecord");
const ReportCard = require("../models/ReportCard");
const Term = require("../models/Term");
const AuditLog = require("../models/AuditLog");
const storageService = require("./storageService");
const Logger = require("../logger");

/**
 * Archive all data for a closed term to S3/Supabase.
 * Idempotent: safe to re-run if archiveS3Key is already set.
 */
async function archiveTerm({ orgId, termId, userId, overrideReason }) {
  const term = await Term.findOne({ _id: termId, orgId });
  if (!term) throw new Error(`Term ${termId} not found for org ${orgId}`);

  if (term.isClosed && term.archiveS3Key) {
    Logger.info("Term already archived, re-running (idempotent)", { termId });
  }

  // Step 1: Validate — check unpublished grades
  const unpublishedCount = await GradeBook.countDocuments({
    orgId,
    termId,
    status: { $ne: "published" },
  });

  if (unpublishedCount > 0 && !overrideReason) {
    throw new Error(
      `Cannot archive: ${unpublishedCount} gradebook entries are not published. Provide overrideReason to force.`,
    );
  }

  // Step 2: Bundle all term data
  Logger.info("Bundling term data for archival", { orgId, termId });

  const [grades, assignments, attendance, reportCards] = await Promise.all([
    GradeBook.find({ orgId, termId }).lean(),
    Assignment.find({ orgId, termId }).lean(),
    AttendanceRecord.find({ orgId, termId }).lean(),
    ReportCard.find({ orgId, termId }).lean(),
  ]);

  const assignmentIds = assignments.map((a) => a._id);
  const submissions =
    assignmentIds.length > 0
      ? await Submission.find({ orgId, assignmentId: { $in: assignmentIds } }).lean()
      : [];

  const bundle = {
    meta: {
      orgId,
      termId,
      archivedAt: new Date().toISOString(),
      archivedBy: userId,
      overrideReason: overrideReason || null,
      counts: {
        grades: grades.length,
        assignments: assignments.length,
        submissions: submissions.length,
        attendance: attendance.length,
        reportCards: reportCards.length,
      },
    },
    grades,
    assignments,
    submissions,
    attendance,
    reportCards,
  };

  // Step 3: Compress
  const jsonStr = JSON.stringify(bundle);
  const compressed = await gzip(Buffer.from(jsonStr, "utf-8"));
  Logger.info("Archive compressed", {
    orgId,
    termId,
    originalSize: jsonStr.length,
    compressedSize: compressed.length,
  });

  // Step 4: Upload to storage
  // s3Key is the relative path WITHOUT the orgs/{orgId}/ prefix
  // storageService.upload prepends that automatically
  const relativeKey = `archives/${termId}.json.gz`;
  await storageService.upload(compressed, relativeKey, "application/gzip", orgId, userId);
  Logger.info("Archive uploaded to storage", { orgId, termId, relativeKey });

  // Step 5: Mark term as closed
  await Term.findByIdAndUpdate(termId, {
    isClosed: true,
    archiveS3Key: relativeKey,
    archivedAt: new Date(),
    closedBy: userId,
  });

  // Step 6: Flag MongoDB records as archived (strict: false to handle field not in schema)
  await Promise.all([
    GradeBook.updateMany({ orgId, termId }, { $set: { isArchived: true } }, { strict: false }),
    Assignment.updateMany(
      { orgId, termId },
      { $set: { isArchived: true } },
      { strict: false },
    ),
    assignmentIds.length > 0
      ? Submission.updateMany(
          { orgId, assignmentId: { $in: assignmentIds } },
          { $set: { isArchived: true } },
          { strict: false },
        )
      : Promise.resolve(),
    AttendanceRecord.updateMany(
      { orgId, termId },
      { $set: { isArchived: true } },
      { strict: false },
    ),
    ReportCard.updateMany(
      { orgId, termId },
      { $set: { isArchived: true } },
      { strict: false },
    ),
  ]);

  // Step 7: Audit log
  await AuditLog.create({
    userId,
    action: "term_closed",
    orgId,
    targetType: "Term",
    targetId: termId,
    details: {
      counts: bundle.meta.counts,
      archiveKey: relativeKey,
      overrideReason: overrideReason || null,
    },
    severity: "critical",
  });

  Logger.info("Term archive complete", { orgId, termId, relativeKey });
  return { archiveKey: relativeKey, counts: bundle.meta.counts };
}

module.exports = { archiveTerm };
