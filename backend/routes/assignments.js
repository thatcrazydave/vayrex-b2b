/**
 * B2B Assignment Routes
 *
 * All routes scoped to /api/org/:orgId/assignments
 *
 * POST   /                         - Create assignment (teacher)
 * GET    /                         - List assignments (teacher: own; student: class; admin: all)
 * GET    /:id                      - Get single assignment
 * PATCH  /:id                      - Update assignment (teacher, only draft)
 * POST   /:id/publish              - Publish/assign to class (teacher)
 * GET    /:id/submissions          - List submissions for an assignment (teacher)
 * PATCH  /:id/submissions/:subId/grade - Grade a submission (teacher)
 *
 * Student-facing:
 * POST   /:id/submit               - Submit answers for an assignment (student)
 */

"use strict";
const router = require("express").Router({ mergeParams: true });
const mongoose = require("mongoose");

const Assignment = require("../models/Assignment");
const Submission = require("../models/Submission");
const Question = require("../models/questions");
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

router.use(authenticateToken, requireOrgMember, denyITAdminAcademic);

// ── POST /api/org/:orgId/assignments ──────────────────────────────
// Teacher creates a new assignment
router.post("/", requireTeacher, async (req, res) => {
  try {
    const {
      classId,
      subjectId,
      termId,
      title,
      description,
      questionIds,
      dueDate,
      maxScore,
      autoGradeObjective,
    } = req.body;
    const user = req.user;

    if (!classId || !subjectId || !termId || !title) {
      return sendError(res, 400, "classId, subjectId, termId, and title are required");
    }

    // ABAC: verify teacher assignment
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

    const newAssignment = await Assignment.create({
      orgId: req.orgId,
      classId,
      subjectId,
      termId,
      createdBy: user._id,
      title: title.trim(),
      description: (description || "").trim(),
      questionIds: questionIds || [],
      dueDate: dueDate ? new Date(dueDate) : undefined,
      maxScore: maxScore || 100,
      autoGradeObjective: autoGradeObjective !== false,
      status: "draft",
    });

    Logger.info("Assignment created", {
      assignmentId: newAssignment._id,
      teacherId: user._id,
      classId,
      subjectId,
    });

    return sendSuccess(res, { assignment: newAssignment }, 201);
  } catch (err) {
    Logger.error("POST /assignments error", { error: err.message });
    return sendError(res, 500, "Failed to create assignment", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/assignments ───────────────────────────────
// Teacher: own assignments; Student: class assignments; Admin: all
router.get("/", async (req, res) => {
  try {
    const { classId, subjectId, termId, status } = req.query;
    const user = req.user;
    const query = { orgId: req.orgId };

    if (classId) query.classId = classId;
    if (subjectId) query.subjectId = subjectId;
    if (termId) query.termId = termId;
    if (status) query.status = status;

    if (user.orgRole === "teacher") {
      query.createdBy = user._id;
    } else if (user.orgRole === "student") {
      // Students see only published/assigned assignments for their class
      query.classId = user.classId;
      query.status = { $in: ["assigned", "submitted", "marked", "published"] };
    }

    const assignments = await Assignment.find(query)
      .populate("subjectId", "name code")
      .populate("classId", "name")
      .populate("createdBy", "fullname username")
      .sort({ createdAt: -1 })
      .lean();

    // For students, attach their own submission status
    if (user.orgRole === "student") {
      const submissions = await Submission.find({
        studentId: user._id,
        assignmentId: { $in: assignments.map((a) => a._id) },
        orgId: req.orgId,
      }).lean();

      const subMap = new Map(submissions.map((s) => [s.assignmentId.toString(), s]));
      assignments.forEach((a) => {
        a.mySubmission = subMap.get(a._id.toString()) || null;
      });
    }

    return sendSuccess(res, { assignments, total: assignments.length });
  } catch (err) {
    Logger.error("GET /assignments error", { error: err.message });
    return sendError(res, 500, "Failed to fetch assignments", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/assignments/:id ───────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const assignment = await Assignment.findOne({
      _id: req.params.id,
      orgId: req.orgId,
    })
      .populate("subjectId", "name code")
      .populate("classId", "name")
      .populate("createdBy", "name")
      .lean();

    if (!assignment) {
      return sendError(res, 404, "Assignment not found", "NOT_FOUND");
    }

    const user = req.user;
    // Students can only see published assignments for their class
    if (user.orgRole === "student") {
      if (
        !user.classId ||
        assignment.classId._id.toString() !== user.classId.toString() ||
        assignment.status === "draft"
      ) {
        return sendError(res, 404, "Assignment not found", "NOT_FOUND");
      }

      // Attach student's own submission
      const submission = await Submission.findOne({
        assignmentId: assignment._id,
        studentId: user._id,
        orgId: req.orgId,
      }).lean();
      assignment.mySubmission = submission || null;
    }

    return sendSuccess(res, { assignment });
  } catch (err) {
    Logger.error("GET /assignments/:id error", { error: err.message });
    return sendError(res, 500, "Failed to fetch assignment", "SERVER_ERROR");
  }
});

// ── PATCH /api/org/:orgId/assignments/:id ─────────────────────────
// Update a draft assignment (teacher only, must be createdBy)
router.patch("/:id", requireTeacher, async (req, res) => {
  try {
    const user = req.user;
    const assignment = await Assignment.findOne({
      _id: req.params.id,
      orgId: req.orgId,
    });

    if (!assignment) {
      return sendError(res, 404, "Assignment not found", "NOT_FOUND");
    }

    // Teachers can only edit their own assignments
    if (
      user.orgRole === "teacher" &&
      assignment.createdBy.toString() !== user._id.toString()
    ) {
      return sendError(res, 403, "You can only edit your own assignments", "FORBIDDEN");
    }

    if (assignment.status !== "draft") {
      return sendError(res, 400, "Only draft assignments can be edited", "NOT_DRAFT");
    }

    const allowed = [
      "title",
      "description",
      "questionIds",
      "dueDate",
      "maxScore",
      "autoGradeObjective",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        assignment[key] = req.body[key];
      }
    }

    await assignment.save();

    Logger.info("Assignment updated", { assignmentId: assignment._id, teacherId: user._id });

    return sendSuccess(res, { assignment });
  } catch (err) {
    Logger.error("PATCH /assignments/:id error", { error: err.message });
    return sendError(res, 500, "Failed to update assignment", "SERVER_ERROR");
  }
});

// ── POST /api/org/:orgId/assignments/:id/publish ──────────────────
// Publish a draft assignment → status becomes "assigned"
router.post("/:id/publish", requireTeacher, async (req, res) => {
  try {
    const user = req.user;
    const assignment = await Assignment.findOne({
      _id: req.params.id,
      orgId: req.orgId,
    });

    if (!assignment) {
      return sendError(res, 404, "Assignment not found", "NOT_FOUND");
    }

    if (
      user.orgRole === "teacher" &&
      assignment.createdBy.toString() !== user._id.toString()
    ) {
      return sendError(res, 403, "You can only publish your own assignments", "FORBIDDEN");
    }

    if (assignment.status !== "draft") {
      return sendError(res, 400, `Assignment is already ${assignment.status}`, "NOT_DRAFT");
    }

    assignment.status = "assigned";
    await assignment.save();

    Logger.info("Assignment published", { assignmentId: assignment._id });

    return sendSuccess(res, { assignment });
  } catch (err) {
    Logger.error("POST /assignments/:id/publish error", { error: err.message });
    return sendError(res, 500, "Failed to publish assignment", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/assignments/:id/submissions ───────────────
// List all submissions for an assignment (teacher/admin)
router.get(
  "/:id/submissions",
  requireOrgRole("owner", "org_admin", "teacher"),
  async (req, res) => {
    try {
      const user = req.user;
      const assignment = await Assignment.findOne({
        _id: req.params.id,
        orgId: req.orgId,
      }).lean();

      if (!assignment) {
        return sendError(res, 404, "Assignment not found", "NOT_FOUND");
      }

      // Teachers can only see submissions for their own assignments
      if (
        user.orgRole === "teacher" &&
        assignment.createdBy.toString() !== user._id.toString()
      ) {
        return sendError(
          res,
          403,
          "You can only view submissions for your own assignments",
          "FORBIDDEN",
        );
      }

      const submissions = await Submission.find({
        assignmentId: req.params.id,
        orgId: req.orgId,
      })
        .populate("studentId", "fullname username email")
        .sort({ submittedAt: -1 })
        .lean();

      return sendSuccess(res, { submissions, total: submissions.length });
    } catch (err) {
      Logger.error("GET /assignments/:id/submissions error", { error: err.message });
      return sendError(res, 500, "Failed to fetch submissions", "SERVER_ERROR");
    }
  },
);

// ── PATCH /api/org/:orgId/assignments/:id/submissions/:subId/grade ─
// Teacher grades a submission
router.patch("/:id/submissions/:subId/grade", requireTeacher, async (req, res) => {
  try {
    const { teacherScore, feedback } = req.body;
    const user = req.user;

    if (teacherScore === undefined && !feedback) {
      return sendError(res, 400, "teacherScore or feedback is required");
    }

    // Verify assignment ownership
    const assignment = await Assignment.findOne({
      _id: req.params.id,
      orgId: req.orgId,
    }).lean();

    if (!assignment) {
      return sendError(res, 404, "Assignment not found", "NOT_FOUND");
    }

    if (
      user.orgRole === "teacher" &&
      assignment.createdBy.toString() !== user._id.toString()
    ) {
      return sendError(res, 403, "You can only grade your own assignments", "FORBIDDEN");
    }

    const submission = await Submission.findOne({
      _id: req.params.subId,
      assignmentId: req.params.id,
      orgId: req.orgId,
    });

    if (!submission) {
      return sendError(res, 404, "Submission not found", "NOT_FOUND");
    }

    if (teacherScore !== undefined) {
      submission.teacherScore = teacherScore;
      submission.totalScore = (submission.autoScore || 0) + teacherScore;
    }
    if (feedback) {
      submission.feedback = feedback;
    }
    submission.gradedAt = new Date();
    submission.status = "graded";

    await submission.save();

    Logger.info("Submission graded", {
      submissionId: submission._id,
      assignmentId: req.params.id,
      teacherId: user._id,
      totalScore: submission.totalScore,
    });

    return sendSuccess(res, { submission });
  } catch (err) {
    Logger.error("PATCH /assignments/:id/submissions/:subId/grade error", {
      error: err.message,
    });
    return sendError(res, 500, "Failed to grade submission", "SERVER_ERROR");
  }
});

// ── POST /api/org/:orgId/assignments/:id/submit ───────────────────
// Student submits answers for an assignment
router.post("/:id/submit", requireOrgRole("student"), async (req, res) => {
  try {
    const { answers } = req.body;
    const user = req.user;

    if (!answers || !Array.isArray(answers)) {
      return sendError(res, 400, "answers array is required");
    }

    const assignment = await Assignment.findOne({
      _id: req.params.id,
      orgId: req.orgId,
      classId: user.classId,
      status: { $in: ["assigned"] },
    }).lean();

    if (!assignment) {
      return sendError(
        res,
        404,
        "Assignment not found or not available for submission",
        "NOT_FOUND",
      );
    }

    // Check due date
    if (assignment.dueDate && new Date() > new Date(assignment.dueDate)) {
      return sendError(res, 400, "Assignment due date has passed", "PAST_DUE");
    }

    // Check for duplicate submission
    const existingSubmission = await Submission.findOne({
      assignmentId: assignment._id,
      studentId: user._id,
      orgId: req.orgId,
    }).lean();

    if (existingSubmission) {
      return sendError(res, 409, "You have already submitted this assignment", "DUPLICATE");
    }

    // ── Auto-grade objective questions ──────────────────────────────
    let autoScore = 0;
    if (assignment.autoGradeObjective && assignment.questionIds.length > 0) {
      const questions = await Question.find({
        _id: { $in: assignment.questionIds },
      })
        .select("_id questionType correctAnswer blankAnswer options")
        .lean();

      const questionMap = new Map(questions.map((q) => [q._id.toString(), q]));

      for (const ans of answers) {
        const question = questionMap.get(ans.questionId?.toString());
        if (!question) continue;

        if (question.questionType === "multiple-choice" || question.questionType === "true-false") {
          // correctAnswer is the index of the correct option
          if (
            question.correctAnswer !== null &&
            question.correctAnswer !== undefined &&
            Number(ans.answer) === question.correctAnswer
          ) {
            autoScore++;
          }
        } else if (question.questionType === "fill-in-blank") {
          // Case-insensitive comparison, trimmed
          if (
            question.blankAnswer &&
            String(ans.answer).trim().toLowerCase() === question.blankAnswer.trim().toLowerCase()
          ) {
            autoScore++;
          }
        }
        // essay & theory are NOT auto-graded — teacher grades manually
      }
    }

    const submission = await Submission.create({
      orgId: req.orgId,
      assignmentId: assignment._id,
      studentId: user._id,
      answers,
      autoScore,
      totalScore: autoScore, // teacherScore starts at 0, will be added on manual grade
      submittedAt: new Date(),
      status: "submitted",
    });

    Logger.info("Assignment submitted", {
      submissionId: submission._id,
      assignmentId: assignment._id,
      studentId: user._id,
      autoScore,
    });

    return sendSuccess(res, { submission }, 201);
  } catch (err) {
    if (err.code === 11000) {
      return sendError(res, 409, "Duplicate submission", "DUPLICATE");
    }
    Logger.error("POST /assignments/:id/submit error", { error: err.message });
    return sendError(res, 500, "Failed to submit assignment", "SERVER_ERROR");
  }
});

module.exports = router;
