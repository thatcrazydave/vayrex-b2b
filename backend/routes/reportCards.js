/**
 * B2B Report Card Routes
 *
 * All routes scoped to /api/org/:orgId/report-cards
 *
 * POST   /generate               - Generate report cards for a class/term
 * POST   /publish                - Publish generated report cards
 * GET    /:studentId/:termId     - View a specific student's report card
 */

"use strict";
const router = require("express").Router({ mergeParams: true });

const GradeBook = require("../models/GradeBook");
const ReportCard = require("../models/ReportCard");
const AttendanceRecord = require("../models/AttendanceRecord");
const Classroom = require("../models/Classroom");
const Organization = require("../models/Organization");
const User = require("../models/User");
const Logger = require("../logger");
const reportCardService = require("../services/reportCardService");

let emailService;
try {
  emailService = require("../services/emailService");
} catch (err) {
  Logger.warn("emailService not available for report card emails", { error: err.message });
  emailService = null;
}

const { authenticateToken } = require("../middleware/auth");
const {
  requireOrgMember,
  requireOrgRole,
  denyITAdminAcademic,
} = require("../middleware/orgAuth");

function sendError(res, status, message, code = "VALIDATION_ERROR") {
  return res.status(status).json({ success: false, error: { code, message } });
}
function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

// All report card routes: authenticated + org member + deny IT admin
router.use(authenticateToken, requireOrgMember, denyITAdminAcademic);

// ── POST /api/org/:orgId/report-cards/generate ────────────────────
// Generate report cards for all students in a class for a given term.
// Requires all grades for the class/term to be published.

router.post("/generate", requireOrgRole("owner", "org_admin"), async (req, res) => {
  try {
    const { classId, termId } = req.body;
    if (!classId || !termId) {
      return sendError(res, 400, "classId and termId are required");
    }

    // Verify all grades for this class/term are published
    const unpublished = await GradeBook.countDocuments({
      orgId: req.orgId,
      classId,
      termId,
      status: { $ne: "published" },
    });

    if (unpublished > 0) {
      return sendError(
        res,
        400,
        `${unpublished} grade(s) are not yet published. Publish all grades first.`,
        "UNPUBLISHED_GRADES",
      );
    }

    // Get students in the class
    const classroom = await Classroom.findOne({
      _id: classId,
      orgId: req.orgId,
    }).lean();
    if (!classroom) return sendError(res, 404, "Classroom not found", "NOT_FOUND");

    const studentIds = classroom.studentIds || [];
    if (studentIds.length === 0) {
      return sendError(res, 400, "No students in this classroom");
    }

    let generated = 0;

    for (const studentId of studentIds) {
      // Get all published grades for this student in this term
      const grades = await GradeBook.find({
        orgId: req.orgId,
        studentId,
        termId,
        status: "published",
      })
        .populate("subjectId", "name code")
        .populate("teacherId", "name")
        .lean();

      // Build grade entries for report card
      const gradeEntries = grades.map((g) => ({
        subjectId: g.subjectId._id,
        teacherId: g.teacherId?._id,
        caScore: g.totalCA,
        examScore: g.totalExam,
        totalScore: g.finalScore,
        letterGrade: g.letterGrade,
        remark: g.remark,
      }));

      // Attendance summary for the term — iterate embedded records
      const attendanceRecords = await AttendanceRecord.find({
        orgId: req.orgId,
        classId,
        termId,
      })
        .select("records")
        .lean();

      let attPresent = 0,
        attAbsent = 0,
        attLate = 0,
        attExcused = 0,
        attTotal = 0;

      for (const rec of attendanceRecords) {
        const entry = (rec.records || []).find(
          (r) => r.studentId.toString() === studentId.toString(),
        );
        if (entry) {
          attTotal++;
          if (entry.status === "present") attPresent++;
          else if (entry.status === "absent") attAbsent++;
          else if (entry.status === "late") attLate++;
          else if (entry.status === "excused") attExcused++;
        }
      }

      const attendanceSummary = {
        present: attPresent,
        absent: attAbsent,
        late: attLate,
        excused: attExcused,
        percentage: attTotal > 0 ? Math.round((attPresent / attTotal) * 100) : 0,
      };

      // Upsert report card
      await ReportCard.findOneAndUpdate(
        { studentId, termId },
        {
          $set: {
            orgId: req.orgId,
            classId,
            grades: gradeEntries,
            attendanceSummary,
            classSize: studentIds.length,
            status: "draft",
          },
        },
        { upsert: true, new: true },
      );

      generated++;
    }

    // Compute class positions after all report cards are created
    const reportCards = await ReportCard.find({
      orgId: req.orgId,
      classId,
      termId,
    }).lean();

    // Sort by average total score descending
    const ranked = reportCards
      .map((rc) => ({
        _id: rc._id,
        avg:
          rc.grades.length > 0
            ? rc.grades.reduce((s, g) => s + g.totalScore, 0) / rc.grades.length
            : 0,
      }))
      .sort((a, b) => b.avg - a.avg);

    for (let i = 0; i < ranked.length; i++) {
      await ReportCard.updateOne({ _id: ranked[i]._id }, { $set: { classPosition: i + 1 } });
    }

    Logger.info("Report cards generated", {
      orgId: req.orgId,
      classId,
      termId,
      generated,
    });

    // Fire-and-forget: generate PDFs and upload to storage
    const org = await Organization.findById(req.orgId).select("name").lean();
    const allCards = await ReportCard.find({ orgId: req.orgId, classId, termId })
      .populate("studentId", "fullname name email")
      .populate("classId", "name level")
      .populate("termId", "name startDate endDate")
      .populate("grades.subjectId", "name code")
      .lean();

    // Generate PDFs in background — don't block the response
    (async () => {
      for (const card of allCards) {
        try {
          const { storageKey } = await reportCardService.generateAndUpload(card, org);
          await ReportCard.updateOne({ _id: card._id }, { $set: { storageKey } });
        } catch (pdfErr) {
          Logger.warn("Report card PDF generation failed", {
            reportCardId: card._id,
            error: pdfErr.message,
          });
        }
      }
    })().catch(() => {});

    return sendSuccess(res, {
      message: `${generated} report card(s) generated`,
      generated,
    });
  } catch (err) {
    Logger.error("POST /report-cards/generate error", { error: err.message });
    return sendError(res, 500, "Failed to generate report cards", "SERVER_ERROR");
  }
});

// ── POST /api/org/:orgId/report-cards/publish ─────────────────────
// Publish all draft report cards for a class/term

router.post("/publish", requireOrgRole("owner", "org_admin"), async (req, res) => {
  try {
    const { classId, termId } = req.body;
    if (!classId || !termId) {
      return sendError(res, 400, "classId and termId are required");
    }

    const result = await ReportCard.updateMany(
      { orgId: req.orgId, classId, termId, status: "draft" },
      {
        $set: {
          status: "published",
          publishedAt: new Date(),
          publishedBy: req.user._id,
        },
      },
    );

    Logger.info("Report cards published", {
      classId,
      termId,
      modifiedCount: result.modifiedCount,
    });

    // Fire-and-forget: email guardians about published report cards
    if (emailService && result.modifiedCount > 0) {
      (async () => {
        try {
          const org = await Organization.findById(req.orgId).select("name").lean();
          const orgName = org?.name || "School";

          const publishedCards = await ReportCard.find({
            orgId: req.orgId,
            classId,
            termId,
            status: "published",
          })
            .populate("studentId", "fullname name email")
            .populate("termId", "name")
            .lean();

          for (const card of publishedCards) {
            const studentId = card.studentId?._id;
            const studentName = card.studentId?.fullname || card.studentId?.name || "Student";
            const termName = card.termId?.name || "Term";

            // Find guardians linked to this student
            const guardians = await User.find({
              organizationId: req.orgId,
              orgRole: "guardian",
              guardianOf: studentId,
            })
              .select("email fullname")
              .lean();

            for (const guardian of guardians) {
              if (guardian.email) {
                try {
                  await emailService.sendReportCardEmail(
                    guardian.email,
                    guardian.fullname || "Parent/Guardian",
                    studentName,
                    termName,
                    orgName,
                    "/guardian-portal",
                  );
                } catch (emailErr) {
                  Logger.warn("Failed to email report card to guardian", {
                    guardianId: guardian._id,
                    error: emailErr.message,
                  });
                }
              }
            }

            // Also email the student if they have an email
            if (card.studentId?.email) {
              try {
                await emailService.sendReportCardEmail(
                  card.studentId.email,
                  studentName,
                  studentName,
                  termName,
                  orgName,
                  "/student",
                );
              } catch (emailErr) {
                Logger.warn("Failed to email report card to student", {
                  studentId,
                  error: emailErr.message,
                });
              }
            }
          }
        } catch (bgErr) {
          Logger.error("Report card email notification failed", { error: bgErr.message });
        }
      })().catch(() => {});
    }

    return sendSuccess(res, {
      message: `${result.modifiedCount} report card(s) published`,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    Logger.error("POST /report-cards/publish error", { error: err.message });
    return sendError(res, 500, "Failed to publish report cards", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/report-cards/:studentId/:termId ───────────
// View a specific student's report card (multi-role access)

router.get("/:studentId/:termId", async (req, res) => {
  try {
    const { studentId, termId } = req.params;
    const user = req.user;

    // ABAC checks
    if (user.orgRole === "student") {
      if (user._id.toString() !== studentId) {
        return sendError(res, 403, "You can only view your own report card", "FORBIDDEN");
      }
    } else if (user.orgRole === "guardian") {
      const isLinked = (user.guardianOf || []).some((id) => id.toString() === studentId);
      if (!isLinked) {
        return sendError(res, 403, "You are not linked to this student", "NOT_GUARDIAN");
      }
    }

    const query = { orgId: req.orgId, studentId, termId };

    // Students and guardians can only see published report cards
    if (user.orgRole === "student" || user.orgRole === "guardian") {
      query.status = "published";
    }

    const reportCard = await ReportCard.findOne(query)
      .populate("studentId", "name email")
      .populate("classId", "name level")
      .populate("termId", "name startDate endDate")
      .populate("grades.subjectId", "name code")
      .populate("grades.teacherId", "name")
      .lean();

    if (!reportCard) {
      return sendError(res, 404, "Report card not found", "NOT_FOUND");
    }

    return sendSuccess(res, { reportCard });
  } catch (err) {
    Logger.error("GET /report-cards/:studentId/:termId error", { error: err.message });
    return sendError(res, 500, "Failed to fetch report card", "SERVER_ERROR");
  }
});

module.exports = router;
