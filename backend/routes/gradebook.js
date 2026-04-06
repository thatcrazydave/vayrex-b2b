/**
 * B2B Grade Book Routes
 *
 * All routes scoped to /api/org/:orgId/gradebook
 *
 * GET    /                              - List grade entries (teacher: own subjects; admin: all)
 * PUT    /:studentId/:subjectId/:termId - Upsert grade entry (teacher enters scores)
 * POST   /submit-for-review             - Teacher marks grades as ready for review
 * POST   /publish                       - Publish reviewed grades for a class/term
 * PATCH  /:entryId/amend                - Admin approves amendment of a published grade
 * GET    /student/:studentId            - Get a student's grades (teacher/student/guardian/admin)
 * GET    /class/:classId/term/:termId   - Class-wide grade report for a term
 */

"use strict";
const router = require("express").Router({ mergeParams: true });
const mongoose = require("mongoose");

const GradeBook = require("../models/GradeBook");
const Organization = require("../models/Organization");
const SubjectAssignment = require("../models/SubjectAssignment");
const User = require("../models/User");
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

// All gradebook routes: authenticated + org member + deny IT admin
router.use(authenticateToken, requireOrgMember, denyITAdminAcademic);

// ── GET /api/org/:orgId/gradebook ─────────────────────────────────
// Teacher: returns grades for their assigned subjects/classes
// Admin/Owner: returns all grades (optionally filtered)
router.get("/", async (req, res) => {
  try {
    const { classId, subjectId, termId, status } = req.query;
    const user = req.user;
    const query = { orgId: req.orgId };

    if (classId) query.classId = classId;
    if (subjectId) query.subjectId = subjectId;
    if (termId) query.termId = termId;
    if (status) query.status = status;

    // Teachers can only see grades for their assigned subjects
    if (user.orgRole === "teacher") {
      const assignments = await SubjectAssignment.find({
        teacherId: user._id,
        orgId: req.orgId,
        isActive: true,
      }).lean();

      if (assignments.length === 0) {
        return sendSuccess(res, { grades: [], total: 0 });
      }

      // Build OR conditions from subject assignments
      query.$or = assignments.map((a) => ({
        classId: a.classId,
        subjectId: a.subjectId,
        termId: a.termId,
      }));

      // Remove top-level filters that are now in $or
      delete query.classId;
      delete query.subjectId;
      delete query.termId;
    }

    const grades = await GradeBook.find(query)
      .populate("studentId", "name email")
      .populate("subjectId", "name code")
      .populate("classId", "name")
      .populate("termId", "name")
      .sort({ createdAt: -1 })
      .lean();

    return sendSuccess(res, { grades, total: grades.length });
  } catch (err) {
    Logger.error("GET /gradebook error", { error: err.message });
    return sendError(res, 500, "Failed to fetch grade entries", "SERVER_ERROR");
  }
});

// ── PUT /api/org/:orgId/gradebook/:studentId/:subjectId/:termId ───
// Teacher enters/updates component scores for a student
router.put("/:studentId/:subjectId/:termId", requireTeacher, async (req, res) => {
  try {
    const { studentId, subjectId, termId } = req.params;
    const { components, classId } = req.body;
    const user = req.user;

    if (!components || !Array.isArray(components) || components.length === 0) {
      return sendError(res, 400, "components array is required");
    }
    if (!classId) {
      return sendError(res, 400, "classId is required");
    }

    // ABAC: verify teacher is assigned to this subject/class/term
    if (user.orgRole === "teacher") {
      const assignment = await SubjectAssignment.findOne({
        teacherId: user._id,
        orgId: req.orgId,
        classId,
        subjectId,
        termId,
        isActive: true,
      }).lean();

      if (!assignment) {
        return sendError(
          res,
          403,
          "You are not assigned to teach this subject in this class",
          "NOT_ASSIGNED",
        );
      }
    }

    // Validate student is in the class
    const student = await User.findOne({
      _id: studentId,
      organizationId: req.orgId,
      classId,
      orgRole: "student",
    }).lean();

    if (!student) {
      return sendError(res, 404, "Student not found in this class", "STUDENT_NOT_FOUND");
    }

    // Validate component types
    const validTypes = ["CA1", "CA2", "MidTerm", "Exam"];
    for (const comp of components) {
      if (!validTypes.includes(comp.type)) {
        return sendError(res, 400, `Invalid component type: ${comp.type}`);
      }
      if (typeof comp.score !== "number" || comp.score < 0) {
        return sendError(res, 400, `Invalid score for ${comp.type}`);
      }
    }

    // Stamp each component with teacher info
    const stampedComponents = components.map((c) => ({
      ...c,
      maxScore: c.maxScore || 100,
      enteredAt: new Date(),
      enteredBy: user._id,
    }));

    // Upsert the grade entry
    const grade = await GradeBook.findOneAndUpdate(
      { studentId, subjectId, termId },
      {
        $set: {
          orgId: req.orgId,
          teacherId: user._id,
          classId,
          components: stampedComponents,
        },
        $setOnInsert: { status: "draft" },
      },
      { upsert: true, new: true, runValidators: true },
    );

    // Trigger pre-save to compute derived fields
    await grade.save();

    Logger.info("Grade entry upserted", {
      gradeId: grade._id,
      studentId,
      subjectId,
      termId,
      teacherId: user._id,
      finalScore: grade.finalScore,
    });

    return sendSuccess(res, { grade }, 200);
  } catch (err) {
    if (err.code === 11000) {
      return sendError(res, 409, "Duplicate grade entry", "DUPLICATE");
    }
    Logger.error("PUT /gradebook/:studentId/:subjectId/:termId error", {
      error: err.message,
    });
    return sendError(res, 500, "Failed to save grade entry", "SERVER_ERROR");
  }
});

// ── POST /api/org/:orgId/gradebook/submit-for-review ──────────────
// Teacher marks draft grades as ready for review (draft → reviewed)
router.post("/submit-for-review", requireTeacher, async (req, res) => {
  try {
    const { classId, subjectId, termId } = req.body;
    const user = req.user;

    if (!classId || !subjectId || !termId) {
      return sendError(res, 400, "classId, subjectId, and termId are required");
    }

    // ABAC: verify teacher is assigned
    const assignment = await SubjectAssignment.findOne({
      teacherId: user._id,
      orgId: req.orgId,
      classId,
      subjectId,
      termId,
      isActive: true,
    }).lean();

    if (!assignment) {
      return sendError(res, 403, "You are not assigned to this subject/class", "NOT_ASSIGNED");
    }

    const result = await GradeBook.updateMany(
      { orgId: req.orgId, classId, subjectId, termId, status: "draft" },
      { $set: { status: "reviewed" } },
    );

    Logger.info("Grades submitted for review", {
      classId,
      subjectId,
      termId,
      modifiedCount: result.modifiedCount,
      submittedBy: user._id,
    });

    return sendSuccess(res, {
      message: `${result.modifiedCount} grade(s) submitted for review`,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    Logger.error("POST /gradebook/submit-for-review error", { error: err.message });
    return sendError(res, 500, "Failed to submit grades for review", "SERVER_ERROR");
  }
});

// ── POST /api/org/:orgId/gradebook/publish ────────────────────────
// Bulk publish reviewed grades for a class/subject/term
router.post("/publish", requireOrgRole("owner", "org_admin", "teacher"), async (req, res) => {
  try {
    const { classId, subjectId, termId } = req.body;
    const user = req.user;

    if (!classId || !subjectId || !termId) {
      return sendError(res, 400, "classId, subjectId, and termId are required");
    }

    // ABAC for teachers
    if (user.orgRole === "teacher") {
      const assignment = await SubjectAssignment.findOne({
        teacherId: user._id,
        orgId: req.orgId,
        classId,
        subjectId,
        termId,
        isActive: true,
      }).lean();

      if (!assignment) {
        return sendError(
          res,
          403,
          "You are not assigned to this subject/class",
          "NOT_ASSIGNED",
        );
      }
    }

    const result = await GradeBook.updateMany(
      { orgId: req.orgId, classId, subjectId, termId, status: "reviewed" },
      {
        $set: {
          status: "published",
          publishedAt: new Date(),
          publishedBy: user._id,
        },
      },
    );

    Logger.info("Grades published", {
      classId,
      subjectId,
      termId,
      modifiedCount: result.modifiedCount,
      publishedBy: user._id,
    });

    return sendSuccess(res, {
      message: `${result.modifiedCount} grade(s) published`,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    Logger.error("POST /gradebook/publish error", { error: err.message });
    return sendError(res, 500, "Failed to publish grades", "SERVER_ERROR");
  }
});

// ── PATCH /api/org/:orgId/gradebook/:entryId/amend ────────────────
// Org admin approves amendment of a published grade entry.
// Reverts status to draft so teacher can edit, logs the amendment.
router.patch("/:entryId/amend", requireOrgRole("owner", "org_admin"), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || typeof reason !== "string" || reason.trim().length < 5) {
      return sendError(res, 400, "A reason (min 5 chars) is required for amendments");
    }

    const grade = await GradeBook.findOne({ _id: req.params.entryId, orgId: req.orgId });
    if (!grade) return sendError(res, 404, "Grade entry not found", "NOT_FOUND");
    if (grade.status !== "published") {
      return sendError(res, 400, "Only published grades can be amended", "INVALID_STATUS");
    }

    // Record amendment in audit trail
    grade.amendments.push({
      reason: reason.trim(),
      previousScore: grade.finalScore,
      newScore: null, // Will be set when teacher re-enters
      amendedBy: req.user._id,
      amendedAt: new Date(),
    });

    grade.status = "draft";
    await grade.save();

    Logger.info("Grade amendment approved", {
      entryId: grade._id,
      studentId: grade.studentId,
      subjectId: grade.subjectId,
      reason: reason.trim(),
      amendedBy: req.user._id,
    });

    return sendSuccess(res, {
      grade,
      message: "Grade reverted to draft for amendment",
    });
  } catch (err) {
    Logger.error("PATCH /gradebook/:entryId/amend error", { error: err.message });
    return sendError(res, 500, "Failed to amend grade", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/gradebook/student/:studentId ──────────────
// Get all grade entries for a specific student (multi-role access)
router.get("/student/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    const { termId } = req.query;
    const user = req.user;

    // ABAC checks
    if (user.orgRole === "student") {
      // Students can only view their own grades
      if (user._id.toString() !== studentId) {
        return sendError(res, 403, "You can only view your own grades", "FORBIDDEN");
      }
    } else if (user.orgRole === "guardian") {
      // Guardians can only view grades of their linked students
      const isLinked = (user.guardianOf || []).some((id) => id.toString() === studentId);
      if (!isLinked) {
        return sendError(res, 403, "You are not linked to this student", "NOT_GUARDIAN");
      }
    }
    // teacher, org_admin, owner: allowed (teacher could be further restricted by assignment if needed)

    const query = { orgId: req.orgId, studentId };
    if (termId) query.termId = termId;

    // Only show published grades to students and guardians
    if (user.orgRole === "student" || user.orgRole === "guardian") {
      query.status = "published";
    }

    const grades = await GradeBook.find(query)
      .populate("subjectId", "name code")
      .populate("classId", "name")
      .populate("termId", "name startDate endDate")
      .populate("teacherId", "name")
      .sort({ "termId.startDate": -1 })
      .lean();

    return sendSuccess(res, { grades, total: grades.length });
  } catch (err) {
    Logger.error("GET /gradebook/student/:studentId error", { error: err.message });
    return sendError(res, 500, "Failed to fetch student grades", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/gradebook/class/:classId/term/:termId ─────
// Class-wide grade report (teacher: only their subjects; admin: all)
router.get(
  "/class/:classId/term/:termId",
  requireOrgRole("owner", "org_admin", "teacher"),
  async (req, res) => {
    try {
      const { classId, termId } = req.params;
      const user = req.user;
      const query = { orgId: req.orgId, classId, termId };

      // Teachers only see grades for their assigned subjects
      if (user.orgRole === "teacher") {
        const assignments = await SubjectAssignment.find({
          teacherId: user._id,
          orgId: req.orgId,
          classId,
          termId,
          isActive: true,
        }).lean();

        if (assignments.length === 0) {
          return sendSuccess(res, { grades: [], total: 0 });
        }

        query.subjectId = { $in: assignments.map((a) => a.subjectId) };
      }

      const grades = await GradeBook.find(query)
        .populate("studentId", "name email")
        .populate("subjectId", "name code")
        .populate("teacherId", "name")
        .sort({ "studentId.name": 1, subjectId: 1 })
        .lean();

      return sendSuccess(res, { grades, total: grades.length });
    } catch (err) {
      Logger.error("GET /gradebook/class/:classId/term/:termId error", {
        error: err.message,
      });
      return sendError(res, 500, "Failed to fetch class grades", "SERVER_ERROR");
    }
  },
);

module.exports = router;
