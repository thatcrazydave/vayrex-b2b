/**
 * B2B Guardian Routes
 *
 * All routes scoped to /api/org/:orgId/guardian
 *
 * GET  /children                              - List guardian's linked children (with names)
 * GET  /children/:studentId/grades            - Published grades for a child
 * GET  /children/:studentId/attendance         - Attendance summary for a child
 * GET  /children/:studentId/report-cards       - Published report cards for a child
 * GET  /children/:studentId/announcements      - Announcements visible to a child
 */

"use strict";
const router = require("express").Router({ mergeParams: true });

const User = require("../models/User");
const GradeBook = require("../models/GradeBook");
const AttendanceRecord = require("../models/AttendanceRecord");
const ReportCard = require("../models/ReportCard");
const Announcement = require("../models/Announcement");
const Logger = require("../logger");

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

router.use(authenticateToken, requireOrgMember, denyITAdminAcademic);
router.use(requireOrgRole("guardian"));

/**
 * Verify the guardian is linked to the requested student.
 */
function verifyGuardianOf(req, res, next) {
  const { studentId } = req.params;
  const guardianOf = req.user.guardianOf || [];
  const isLinked = guardianOf.some((id) => id.toString() === studentId);
  if (!isLinked) {
    return sendError(res, 403, "You are not linked to this student", "NOT_GUARDIAN");
  }
  next();
}

// ── GET /api/org/:orgId/guardian/children ─────────────────────────
// Returns the guardian's linked children with their profile info
router.get("/children", async (req, res) => {
  try {
    const guardianOf = req.user.guardianOf || [];
    if (guardianOf.length === 0) {
      return sendSuccess(res, { children: [] });
    }

    const children = await User.find({
      _id: { $in: guardianOf },
      organizationId: req.orgId,
    })
      .select("fullname email classId orgRole")
      .populate("classId", "name level")
      .lean();

    return sendSuccess(res, { children });
  } catch (err) {
    Logger.error("GET /guardian/children error", { error: err.message });
    return sendError(res, 500, "Failed to fetch children", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/guardian/children/:studentId/grades ──────
// Returns published grades for a specific child
router.get("/children/:studentId/grades", verifyGuardianOf, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { termId } = req.query;

    const query = {
      orgId: req.orgId,
      studentId,
      status: "published",
    };
    if (termId) query.termId = termId;

    const grades = await GradeBook.find(query)
      .populate("subjectId", "name code")
      .populate("teacherId", "fullname")
      .populate("termId", "name")
      .sort({ createdAt: -1 })
      .lean();

    return sendSuccess(res, { grades });
  } catch (err) {
    Logger.error("GET /guardian/children/:studentId/grades error", { error: err.message });
    return sendError(res, 500, "Failed to fetch grades", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/guardian/children/:studentId/attendance ──
// Returns attendance summary for a specific child
router.get("/children/:studentId/attendance", verifyGuardianOf, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { termId } = req.query;

    // Find the student's class
    const student = await User.findOne({
      _id: studentId,
      organizationId: req.orgId,
      orgRole: "student",
    })
      .select("classId fullname")
      .lean();

    if (!student || !student.classId) {
      return sendError(res, 404, "Student not found or not in a class", "NOT_FOUND");
    }

    const query = { orgId: req.orgId, classId: student.classId };
    if (termId) query.termId = termId;

    const records = await AttendanceRecord.find(query).sort({ date: 1 }).lean();

    let present = 0,
      absent = 0,
      late = 0,
      excused = 0,
      totalDays = 0;

    const timeline = [];

    for (const record of records) {
      const entry = record.records.find((r) => r.studentId.toString() === studentId);
      if (entry) {
        totalDays++;
        if (entry.status === "present") present++;
        else if (entry.status === "absent") absent++;
        else if (entry.status === "late") late++;
        else if (entry.status === "excused") excused++;

        timeline.push({
          date: record.date,
          period: record.period,
          status: entry.status,
          note: entry.note || "",
        });
      }
    }

    const percentage = totalDays > 0 ? Math.round((present / totalDays) * 10000) / 100 : 0;

    return sendSuccess(res, {
      student: { _id: student._id, fullname: student.fullname },
      summary: { present, absent, late, excused, totalDays, percentage },
      timeline: timeline.slice(-30), // last 30 entries
    });
  } catch (err) {
    Logger.error("GET /guardian/children/:studentId/attendance error", { error: err.message });
    return sendError(res, 500, "Failed to fetch attendance", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/guardian/children/:studentId/report-cards ─
// Returns published report cards for a specific child
router.get("/children/:studentId/report-cards", verifyGuardianOf, async (req, res) => {
  try {
    const { studentId } = req.params;

    const reportCards = await ReportCard.find({
      orgId: req.orgId,
      studentId,
      status: "published",
    })
      .populate("classId", "name level")
      .populate("termId", "name startDate endDate")
      .populate("grades.subjectId", "name code")
      .sort({ publishedAt: -1 })
      .lean();

    return sendSuccess(res, { reportCards });
  } catch (err) {
    Logger.error("GET /guardian/children/:studentId/report-cards error", {
      error: err.message,
    });
    return sendError(res, 500, "Failed to fetch report cards", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/guardian/children/:studentId/announcements
// Returns announcements visible to a specific child
router.get("/children/:studentId/announcements", verifyGuardianOf, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { limit = 20, skip = 0 } = req.query;

    const announcements = await Announcement.find({
      orgId: req.orgId,
      recipientList: studentId,
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    })
      .populate("createdBy", "fullname orgRole")
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit))
      .lean();

    return sendSuccess(res, { announcements });
  } catch (err) {
    Logger.error("GET /guardian/children/:studentId/announcements error", {
      error: err.message,
    });
    return sendError(res, 500, "Failed to fetch announcements", "SERVER_ERROR");
  }
});

module.exports = router;
