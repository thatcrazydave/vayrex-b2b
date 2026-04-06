/**
 * B2B Attendance Routes
 *
 * All routes scoped to /api/org/:orgId/attendance
 *
 * POST /                        - Record attendance for a class/date (teacher)
 * GET  /:classId                - List attendance records for a class (teacher/admin)
 * GET  /:classId/date/:date     - Get single attendance record for a specific date
 * GET  /student/:studentId      - Get attendance summary for a student (teacher/student/guardian/admin)
 */

"use strict";
const router = require("express").Router({ mergeParams: true });

const AttendanceRecord = require("../models/AttendanceRecord");
const SubjectAssignment = require("../models/SubjectAssignment");
const Classroom = require("../models/Classroom");
const User = require("../models/User");
const AttendanceService = require("../services/attendanceService");
const Logger = require("../logger");

const { authenticateToken } = require("../middleware/auth");
const {
  requireOrgMember,
  requireTeacher,
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

// ── POST /api/org/:orgId/attendance ───────────────────────────────
// Teacher records attendance for a class/date/period
router.post("/", requireTeacher, async (req, res) => {
  try {
    const { classId, termId, date, period, records } = req.body;
    const user = req.user;

    if (!classId || !termId || !date || !records || !Array.isArray(records)) {
      return sendError(res, 400, "classId, termId, date, and records array are required");
    }

    // ABAC: verify teacher has access to this class
    if (user.orgRole === "teacher") {
      // Teacher must be class teacher OR have a subject assignment for this class
      const classroom = await Classroom.findOne({
        _id: classId,
        orgId: req.orgId,
        classTeacherId: user._id,
      }).lean();

      if (!classroom) {
        const hasAssignment = await SubjectAssignment.findOne({
          teacherId: user._id,
          orgId: req.orgId,
          classId,
          termId,
          isActive: true,
        }).lean();

        if (!hasAssignment) {
          return sendError(res, 403, "You are not assigned to this class", "NOT_ASSIGNED");
        }
      }
    }

    // Validate each record entry
    const validStatuses = ["present", "absent", "late", "excused"];
    for (const record of records) {
      if (!record.studentId || !record.status) {
        return sendError(res, 400, "Each record must have studentId and status");
      }
      if (!validStatuses.includes(record.status)) {
        return sendError(res, 400, `Invalid status: ${record.status}`);
      }
    }

    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);
    const attendancePeriod = period || "full-day";

    // Check if record is locked (editing after 24h)
    const existingRecord = await AttendanceRecord.findOne({
      classId,
      date: attendanceDate,
      period: attendancePeriod,
    }).lean();

    if (existingRecord && existingRecord.isLocked) {
      // Only admin can edit locked records
      if (user.orgRole === "teacher") {
        return sendError(
          res,
          403,
          "This attendance record is locked. Contact an admin to amend.",
          "LOCKED",
        );
      }
    }

    const attendance = await AttendanceRecord.findOneAndUpdate(
      { classId, date: attendanceDate, period: attendancePeriod },
      {
        $set: {
          orgId: req.orgId,
          teacherId: user._id,
          termId,
          records,
        },
        $setOnInsert: {
          isLocked: false,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );

    Logger.info("Attendance recorded", {
      attendanceId: attendance._id,
      classId,
      date: attendanceDate,
      period: attendancePeriod,
      recordCount: records.length,
      teacherId: user._id,
    });

    // Fire-and-forget: check attendance threshold alerts
    AttendanceService.checkThresholdAlerts(req.orgId, classId, termId, records).catch(() => {});

    return sendSuccess(res, { attendance }, existingRecord ? 200 : 201);
  } catch (err) {
    if (err.code === 11000) {
      return sendError(res, 409, "Duplicate attendance record", "DUPLICATE");
    }
    Logger.error("POST /attendance error", { error: err.message });
    return sendError(res, 500, "Failed to record attendance", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/attendance/:classId ───────────────────────
// List attendance records for a class (with optional date range)
router.get("/:classId", requireOrgRole("owner", "org_admin", "teacher"), async (req, res) => {
  try {
    const { classId } = req.params;
    const { termId, startDate, endDate } = req.query;
    const user = req.user;

    // ABAC for teachers
    if (user.orgRole === "teacher") {
      const classroom = await Classroom.findOne({
        _id: classId,
        orgId: req.orgId,
        classTeacherId: user._id,
      }).lean();

      if (!classroom) {
        const hasAssignment = await SubjectAssignment.findOne({
          teacherId: user._id,
          orgId: req.orgId,
          classId,
          isActive: true,
        }).lean();

        if (!hasAssignment) {
          return sendError(res, 403, "You are not assigned to this class", "NOT_ASSIGNED");
        }
      }
    }

    const query = { orgId: req.orgId, classId };
    if (termId) query.termId = termId;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const records = await AttendanceRecord.find(query)
      .populate("teacherId", "name")
      .sort({ date: -1 })
      .lean();

    return sendSuccess(res, { records, total: records.length });
  } catch (err) {
    Logger.error("GET /attendance/:classId error", { error: err.message });
    return sendError(res, 500, "Failed to fetch attendance records", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/attendance/:classId/date/:date ────────────
// Get attendance for a specific class/date
router.get(
  "/:classId/date/:date",
  requireOrgRole("owner", "org_admin", "teacher"),
  async (req, res) => {
    try {
      const { classId, date } = req.params;
      const { period } = req.query;

      const attendanceDate = new Date(date);
      attendanceDate.setHours(0, 0, 0, 0);

      const query = { orgId: req.orgId, classId, date: attendanceDate };
      if (period) query.period = period;

      const record = await AttendanceRecord.findOne(query)
        .populate("records.studentId", "name email")
        .populate("teacherId", "name")
        .lean();

      if (!record) {
        return sendError(res, 404, "Attendance record not found", "NOT_FOUND");
      }

      return sendSuccess(res, { record });
    } catch (err) {
      Logger.error("GET /attendance/:classId/date/:date error", { error: err.message });
      return sendError(res, 500, "Failed to fetch attendance record", "SERVER_ERROR");
    }
  },
);

// ── GET /api/org/:orgId/attendance/student/:studentId ─────────────
// Get attendance summary for a student (multi-role access)
router.get("/student/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    const { termId } = req.query;
    const user = req.user;

    // ABAC checks
    if (user.orgRole === "student") {
      if (user._id.toString() !== studentId) {
        return sendError(res, 403, "You can only view your own attendance", "FORBIDDEN");
      }
    } else if (user.orgRole === "guardian") {
      const isLinked = (user.guardianOf || []).some((id) => id.toString() === studentId);
      if (!isLinked) {
        return sendError(res, 403, "You are not linked to this student", "NOT_GUARDIAN");
      }
    }

    // Find the student's class
    const student = await User.findOne({
      _id: studentId,
      organizationId: req.orgId,
      orgRole: "student",
    })
      .select("classId name")
      .lean();

    if (!student || !student.classId) {
      return sendError(res, 404, "Student not found or not in a class", "NOT_FOUND");
    }

    const query = { orgId: req.orgId, classId: student.classId };
    if (termId) query.termId = termId;

    const records = await AttendanceRecord.find(query).sort({ date: 1 }).lean();

    // Compute summary from the student's entries
    let present = 0,
      absent = 0,
      late = 0,
      excused = 0,
      totalDays = 0;

    for (const record of records) {
      const entry = record.records.find((r) => r.studentId.toString() === studentId);
      if (entry) {
        totalDays++;
        if (entry.status === "present") present++;
        else if (entry.status === "absent") absent++;
        else if (entry.status === "late") late++;
        else if (entry.status === "excused") excused++;
      }
    }

    const percentage = totalDays > 0 ? Math.round((present / totalDays) * 10000) / 100 : 0;

    return sendSuccess(res, {
      student: { _id: student._id, name: student.name },
      summary: { present, absent, late, excused, totalDays, percentage },
    });
  } catch (err) {
    Logger.error("GET /attendance/student/:studentId error", { error: err.message });
    return sendError(res, 500, "Failed to fetch attendance summary", "SERVER_ERROR");
  }
});

module.exports = router;
