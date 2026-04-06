/**
 * B2B Org Management Routes
 *
 * POST /api/org/:orgId/invites          - Send an invitation email (owner/org_admin/it_admin)
 * GET  /api/org/:orgId/invites          - List pending invites
 * DELETE /api/org/:orgId/invites/:inviteId - Revoke a pending invite
 * GET  /api/org/:orgId/members          - List org members
 * DELETE /api/org/:orgId/members/:userId - Remove a member (revoke seat)
 *
 * POST /api/org/:orgId/academic-years   - Create academic year  (owner/org_admin)
 * GET  /api/org/:orgId/academic-years   - List academic years
 * POST /api/org/:orgId/classrooms       - Create classroom       (owner/org_admin/it_admin)
 * GET  /api/org/:orgId/classrooms       - List classrooms
 * POST /api/org/:orgId/subjects         - Create subject         (owner/org_admin)
 * GET  /api/org/:orgId/subjects         - List subjects
 * GET  /api/org/:orgId/profile          - Get org public profile  (any org member)
 *
 * POST /api/org/:orgId/invites/bulk     - Bulk invite via JSON array (queued via BullMQ)
 */

"use strict";
const router = require("express").Router({ mergeParams: true });
const crypto = require("crypto");
const mongoose = require("mongoose");

const Organization = require("../models/Organization");
const Invitation = require("../models/Invitation");
const AcademicYear = require("../models/AcademicYear");
const Term = require("../models/Term");
const Classroom = require("../models/Classroom");
const Subject = require("../models/Subject");
const SubjectAssignment = require("../models/SubjectAssignment");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const MoveRequest = require("../models/MoveRequest");
const emailService = require("../services/emailService");
const Logger = require("../logger");
const { authenticateToken } = require("../middleware/auth");
const {
  requireOrgMember,
  requireOrgAdmin,
  requireITAdmin,
  requireOwner,
  requireTeacher,
} = require("../middleware/orgAuth");
const { isValidEmail } = require("../middleware/sanitizer");

const VALID_INVITE_ROLES = ["org_admin", "it_admin", "teacher", "student", "guardian"];

function sendError(res, status, message, code = "VALIDATION_ERROR") {
  return res.status(status).json({ success: false, error: { code, message } });
}
function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

// All org routes require authentication + org membership
router.use(authenticateToken, requireOrgMember);

// ── GET /api/org/:orgId/profile ───────────────────────────────────────────────

router.get("/profile", async (req, res) => {
  try {
    const org = await Organization.findById(req.orgId)
      .select("-billingContactId -billingContactEmail")
      .lean();
    if (!org) return sendError(res, 404, "Organisation not found", "ORG_NOT_FOUND");
    return sendSuccess(res, { org });
  } catch (err) {
    Logger.error("org/profile error", { error: err.message });
    return sendError(res, 500, "Failed to load organisation", "INTERNAL_ERROR");
  }
});

// ── POST /api/org/:orgId/invites ──────────────────────────────────────────────

router.post("/invites", requireITAdmin, async (req, res) => {
  try {
    const { email, orgRole, classId, guardianStudentId } = req.body;
    const normalizedEmail = email?.toLowerCase();

    if (!email || !isValidEmail(email)) {
      return sendError(res, 400, "A valid email address is required");
    }
    if (!orgRole || !VALID_INVITE_ROLES.includes(orgRole)) {
      return sendError(res, 400, `orgRole must be one of: ${VALID_INVITE_ROLES.join(", ")}`);
    }

    const org = await Organization.findById(req.orgId).select("name _id").lean();
    if (!org) return sendError(res, 404, "Organisation not found", "ORG_NOT_FOUND");

    // Check for unexpired pending invite to same email in this org
    const existing = await Invitation.findOne({
      orgId: req.orgId,
      email: normalizedEmail,
      status: "pending",
      expiresAt: { $gt: new Date() },
    });

    let invitation;
    let rawToken;
    let wasResent = false;

    if (existing) {
      wasResent = true;
      rawToken = crypto.randomBytes(32).toString("hex");
      existing.tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      existing.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      existing.orgRole = orgRole;
      existing.classId = classId || null;
      existing.invitedBy = req.user.id;
      await existing.save();
      invitation = existing;
    } else {
      ({ invitation, rawToken } = await Invitation.createInvite({
        orgId: req.orgId,
        email: normalizedEmail,
        orgRole,
        invitedBy: req.user.id,
        classId: classId || null,
      }));
    }

    // Attach rawToken temporarily so email methods can use it
    invitation.rawToken = rawToken;

    let emailSent = true;
    let emailError = null;

    try {
      if (orgRole === "guardian" && guardianStudentId) {
        const student = await User.findOne({
          _id: guardianStudentId,
          organizationId: req.orgId,
        })
          .select("username")
          .lean();
        if (student) {
          await emailService.sendGuardianInviteEmail(invitation, student.username, org);
        } else {
          await emailService.sendInvitationEmail(invitation, org);
        }
      } else {
        await emailService.sendInvitationEmail(invitation, org);
      }
    } catch (err) {
      emailSent = false;
      emailError = err.message;
      Logger.error("Invite email delivery failed", {
        orgId: req.orgId,
        inviteId: invitation._id,
        to: normalizedEmail,
        error: err.message,
        code: err.code,
      });
    }

    AuditLog.create({
      userId: req.user.id,
      action: "org_member_invited",
      orgId: req.orgId,
      details: {
        inviteeEmail: normalizedEmail,
        role: orgRole,
        inviteId: invitation._id,
        wasResent,
        emailSent,
        emailError,
      },
      ip: req.ip,
    }).catch(() => {});

    if (!emailSent) {
      const guardianParam =
        orgRole === "guardian" && invitation.guardianCode
          ? `&guardianCode=${encodeURIComponent(invitation.guardianCode)}`
          : "";
      const manualInviteUrl = `${process.env.FRONTEND_URL}/Signup?inviteToken=${rawToken}${guardianParam}`;
      return sendSuccess(
        res,
        {
          inviteId: invitation._id,
          emailSent: false,
          inviteUrl: manualInviteUrl,
          message:
            "Invitation saved, but email delivery failed. You can retry later or share the invite link manually.",
        },
        wasResent ? 200 : 201,
      );
    }

    return sendSuccess(
      res,
      {
        inviteId: invitation._id,
        emailSent: true,
        message: wasResent
          ? `Invitation resent to ${normalizedEmail}`
          : `Invitation sent to ${normalizedEmail}`,
      },
      wasResent ? 200 : 201,
    );
  } catch (err) {
    Logger.error("POST invites error", { error: err.message });
    return sendError(res, 500, "Failed to send invitation", "INTERNAL_ERROR");
  }
});

// ── GET /api/org/:orgId/invites ───────────────────────────────────────────────

router.get("/invites", requireITAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const filter = { orgId: req.orgId };
    if (req.query.status) filter.status = req.query.status;

    const [invites, total] = await Promise.all([
      Invitation.find(filter)
        .select("-tokenHash")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Invitation.countDocuments(filter),
    ]);

    return sendSuccess(res, {
      invites,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    Logger.error("GET invites error", { error: err.message });
    return sendError(res, 500, "Failed to load invites", "INTERNAL_ERROR");
  }
});

// ── DELETE /api/org/:orgId/invites/:inviteId ──────────────────────────────────

router.delete("/invites/:inviteId", requireITAdmin, async (req, res) => {
  try {
    const invite = await Invitation.findOne({ _id: req.params.inviteId, orgId: req.orgId });
    if (!invite) return sendError(res, 404, "Invitation not found", "INVITE_NOT_FOUND");
    if (invite.status !== "pending")
      return sendError(res, 400, "Only pending invitations can be revoked");

    invite.status = "revoked";
    await invite.save();

    return sendSuccess(res, { message: "Invitation revoked" });
  } catch (err) {
    Logger.error("DELETE invite error", { error: err.message });
    return sendError(res, 500, "Failed to revoke invitation", "INTERNAL_ERROR");
  }
});

// ── GET /api/org/:orgId/members ───────────────────────────────────────────────

router.get("/members", requireITAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 30);
    const filter = { organizationId: req.orgId };
    if (req.query.role) filter.orgRole = req.query.role;

    const [members, total] = await Promise.all([
      User.find(filter)
        .select("username fullname email orgRole classId seatAssignedAt emailVerified isActive")
        .populate("classId", "name")
        .sort({ seatAssignedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    return sendSuccess(res, {
      members,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    Logger.error("GET members error", { error: err.message });
    return sendError(res, 500, "Failed to load members", "INTERNAL_ERROR");
  }
});

// ── DELETE /api/org/:orgId/members/:userId ────────────────────────────────────
// Revoke seat — removes user from org but does NOT delete their account

router.delete("/members/:userId", requireOrgAdmin, async (req, res) => {
  try {
    // Prevent removing self
    if (req.params.userId === req.user.id) {
      return sendError(res, 400, "You cannot remove yourself from the organisation");
    }

    const target = await User.findOne({ _id: req.params.userId, organizationId: req.orgId });
    if (!target) return sendError(res, 404, "Member not found", "MEMBER_NOT_FOUND");

    // Owner can only be removed by another owner (not applicable in MVP where one owner exists)
    if (target.orgRole === "owner") {
      return sendError(res, 403, "The organisation owner cannot be removed", "FORBIDDEN");
    }

    const orgRole = target.orgRole;
    const oldClassId = target.classId;

    target.organizationId = null;
    target.orgRole = null;
    target.seatAssignedAt = null;
    target.classId = null;
    target.guardianOf = [];
    await target.save();

    // Consistency: pull student out of their classroom roster if they were in one
    if (oldClassId) {
      await Classroom.findByIdAndUpdate(oldClassId, {
        $pull: { studentIds: target._id }
      }).catch(err => Logger.error("Failed to pull removed student from classroom", { error: err.message, userId: target._id, classId: oldClassId }));
    }

    // Decrement enrollmentCount
    await Organization.findByIdAndUpdate(req.orgId, { $inc: { enrollmentCount: -1 } });

    AuditLog.create({
      userId: req.user.id,
      action: "org_member_removed",
      orgId: req.orgId,
      details: { removedUserId: req.params.userId, role: orgRole },
      ip: req.ip,
    }).catch(() => {});

    return sendSuccess(res, { message: "Member removed from organisation" });
  } catch (err) {
    Logger.error("DELETE member error", { error: err.message });
    return sendError(res, 500, "Failed to remove member", "INTERNAL_ERROR");
  }
});

// ── POST /api/org/:orgId/academic-years ──────────────────────────────────────
// Auto-creates three terms (First, Second, Third) for the new academic year.

router.post("/academic-years", requireOrgAdmin, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, startDate, endDate, terms: termDates } = req.body;
    if (!name || typeof name !== "string" || name.trim().length < 3) {
      return sendError(res, 400, "Academic year name is required (min 3 chars)");
    }
    if (!startDate || !endDate) {
      return sendError(res, 400, "Start date and end date are required");
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start) || isNaN(end)) return sendError(res, 400, "Invalid date format");
    if (end <= start) return sendError(res, 400, "End date must be after start date");

    const [year] = await AcademicYear.create(
      [
        {
          orgId: req.orgId,
          name: name.trim(),
          startDate: start,
          endDate: end,
          isActive: false,
          isArchived: false,
          createdBy: req.user.id,
          terms: [],
        },
      ],
      { session },
    );

    // Auto-create 3 terms — split the academic year span into equal thirds
    // Each third is: totalMs / 3, with a 1-day gap between terms
    const termNames = ["First Term", "Second Term", "Third Term"];
    const totalMs = end.getTime() - start.getTime();
    const thirdMs = Math.floor(totalMs / 3);
    const gapMs = 24 * 60 * 60 * 1000; // 1-day gap between terms

    const autoTermDates = [
      {
        startDate: new Date(start),
        endDate: new Date(start.getTime() + thirdMs),
      },
      {
        startDate: new Date(start.getTime() + thirdMs + gapMs),
        endDate: new Date(start.getTime() + 2 * thirdMs + gapMs),
      },
      {
        startDate: new Date(start.getTime() + 2 * thirdMs + 2 * gapMs),
        endDate: new Date(end),
      },
    ];

    const createdTerms = [];
    for (let i = 0; i < termNames.length; i++) {
      const tDates = termDates?.[i] || {};
      const [term] = await Term.create(
        [
          {
            orgId: req.orgId,
            academicYearId: year._id,
            name: termNames[i],
            startDate: tDates.startDate ? new Date(tDates.startDate) : autoTermDates[i].startDate,
            endDate: tDates.endDate ? new Date(tDates.endDate) : autoTermDates[i].endDate,
            isActive: false,
            isClosed: false,
          },
        ],
        { session },
      );
      createdTerms.push(term);
    }

    year.terms = createdTerms.map((t) => t._id);
    await year.save({ session });

    await session.commitTransaction();
    return sendSuccess(res, { academicYear: year, terms: createdTerms }, 201);
  } catch (err) {
    await session.abortTransaction().catch(() => {});
    if (err.code === 11000)
      return sendError(
        res,
        409,
        "An academic year with this name already exists",
        "DUPLICATE",
      );
    Logger.error("POST academic-years error", { error: err.message });
    return sendError(res, 500, "Failed to create academic year", "INTERNAL_ERROR");
  } finally {
    session.endSession();
  }
});

// ── GET /api/org/:orgId/academic-years ───────────────────────────────────────

router.get("/academic-years", async (req, res) => {
  try {
    const years = await AcademicYear.find({ orgId: req.orgId })
      .populate("terms")
      .sort({ startDate: -1 })
      .lean();
    return sendSuccess(res, { academicYears: years });
  } catch (err) {
    Logger.error("GET academic-years error", { error: err.message });
    return sendError(res, 500, "Failed to load academic years", "INTERNAL_ERROR");
  }
});

// ── POST /api/org/:orgId/academic-years/:yearId/activate ─────────────────────
// Activates an academic year (only one can be active at a time per org).

router.post("/academic-years/:yearId/activate", requireOrgAdmin, async (req, res) => {
  try {
    // Deactivate all other years for this org
    await AcademicYear.updateMany(
      { orgId: req.orgId, isActive: true },
      { $set: { isActive: false } },
    );

    const year = await AcademicYear.findOneAndUpdate(
      { _id: req.params.yearId, orgId: req.orgId },
      { $set: { isActive: true } },
      { new: true },
    ).populate("terms");

    if (!year) return sendError(res, 404, "Academic year not found", "NOT_FOUND");

    Logger.info("Academic year activated", {
      orgId: req.orgId,
      yearId: year._id,
      name: year.name,
    });
    return sendSuccess(res, { academicYear: year });
  } catch (err) {
    Logger.error("POST academic-years/:yearId/activate error", { error: err.message });
    return sendError(res, 500, "Failed to activate academic year", "INTERNAL_ERROR");
  }
});

// ── GET /api/org/:orgId/terms ────────────────────────────────────────────────

router.get("/terms", async (req, res) => {
  try {
    const { academicYearId } = req.query;
    const query = { orgId: req.orgId };
    if (academicYearId) query.academicYearId = academicYearId;

    const terms = await Term.find(query)
      .populate("academicYearId", "name")
      .sort({ startDate: 1 })
      .lean();
    return sendSuccess(res, { terms });
  } catch (err) {
    Logger.error("GET terms error", { error: err.message });
    return sendError(res, 500, "Failed to load terms", "INTERNAL_ERROR");
  }
});

// ── PATCH /api/org/:orgId/terms/:termId ──────────────────────────────────────
// Update term dates (only if not closed).

router.patch("/terms/:termId", requireOrgAdmin, async (req, res) => {
  try {
    const term = await Term.findOne({ _id: req.params.termId, orgId: req.orgId });
    if (!term) return sendError(res, 404, "Term not found", "NOT_FOUND");
    if (term.isClosed)
      return sendError(res, 400, "Cannot modify a closed term", "TERM_CLOSED");

    const { startDate, endDate } = req.body;
    if (startDate) term.startDate = new Date(startDate);
    if (endDate) term.endDate = new Date(endDate);
    await term.save();

    return sendSuccess(res, { term });
  } catch (err) {
    Logger.error("PATCH terms/:termId error", { error: err.message });
    return sendError(res, 500, "Failed to update term", "INTERNAL_ERROR");
  }
});

// ── POST /api/org/:orgId/terms/:termId/open ──────────────────────────────────
// Opens a term (only one active per org). Previous active term is auto-paused.

router.post("/terms/:termId/open", requireOrgAdmin, async (req, res) => {
  try {
    const term = await Term.findOne({ _id: req.params.termId, orgId: req.orgId });
    if (!term) return sendError(res, 404, "Term not found", "NOT_FOUND");
    if (term.isClosed)
      return sendError(res, 400, "Cannot reopen a closed term", "TERM_CLOSED");

    // Deactivate any currently active term
    await Term.updateMany({ orgId: req.orgId, isActive: true }, { $set: { isActive: false } });

    // Also ensure the parent academic year is active
    await AcademicYear.updateMany(
      { orgId: req.orgId, isActive: true },
      { $set: { isActive: false } },
    );
    await AcademicYear.findByIdAndUpdate(term.academicYearId, { $set: { isActive: true } });

    term.isActive = true;
    await term.save();

    AuditLog.create({
      userId: req.user.id,
      action: "term_opened",
      orgId: req.orgId,
      details: { termId: term._id, termName: term.name },
      ip: req.ip,
    }).catch(() => {});

    Logger.info("Term opened", { orgId: req.orgId, termId: term._id, name: term.name });
    return sendSuccess(res, { term, message: `${term.name} is now active` });
  } catch (err) {
    Logger.error("POST terms/:termId/open error", { error: err.message });
    return sendError(res, 500, "Failed to open term", "INTERNAL_ERROR");
  }
});

// ── POST /api/org/:orgId/terms/:termId/close ─────────────────────────────────
// Closes the active term. Validates all gradebooks are published (warning if not).

router.post("/terms/:termId/close", requireOrgAdmin, async (req, res) => {
  try {
    const GradeBook = require("../models/GradeBook");

    const term = await Term.findOne({ _id: req.params.termId, orgId: req.orgId });
    if (!term) return sendError(res, 404, "Term not found", "NOT_FOUND");
    if (term.isClosed) return sendError(res, 400, "Term is already closed", "TERM_CLOSED");

    // Check unpublished grades
    const unpublishedCount = await GradeBook.countDocuments({
      orgId: req.orgId,
      termId: term._id,
      status: { $ne: "published" },
    });

    const { force, reason } = req.body;
    if (unpublishedCount > 0 && !force) {
      return res.status(422).json({
        success: false,
        error: {
          code: "UNPUBLISHED_GRADES",
          message: `${unpublishedCount} grade book entries are not published. Pass { force: true, reason: "..." } to override.`,
          unpublishedCount,
        },
      });
    }

    term.isActive = false;
    term.isClosed = true;
    term.closedBy = req.user.id;
    term.archivedAt = new Date();
    await term.save();

    // Check if all 3 terms are closed for this academic year
    const siblingTerms = await Term.find({ academicYearId: term.academicYearId }).lean();
    const allClosed = siblingTerms.every((t) => t.isClosed);
    if (allClosed) {
      await AcademicYear.findByIdAndUpdate(term.academicYearId, {
        $set: { isArchived: true, isActive: false },
      });
    }

    AuditLog.create({
      userId: req.user.id,
      action: "term_closed",
      orgId: req.orgId,
      details: {
        termId: term._id,
        termName: term.name,
        unpublishedOverride: unpublishedCount > 0,
        reason: reason || null,
      },
      ip: req.ip,
    }).catch(() => {});

    Logger.info("Term closed", {
      orgId: req.orgId,
      termId: term._id,
      name: term.name,
      allTermsClosed: allClosed,
    });

    return sendSuccess(res, {
      term,
      allTermsClosed: allClosed,
      message: `${term.name} has been closed${allClosed ? ". All terms are now closed — year archived." : "."}`,
    });
  } catch (err) {
    Logger.error("POST terms/:termId/close error", { error: err.message });
    return sendError(res, 500, "Failed to close term", "INTERNAL_ERROR");
  }
});

// ── POST /api/org/:orgId/classrooms ──────────────────────────────────────────

router.post("/classrooms", requireITAdmin, async (req, res) => {
  try {
    const { name, level, academicYearId, classTeacherId, capacity } = req.body;
    if (!name || typeof name !== "string" || name.trim().length < 1) {
      return sendError(res, 400, "Classroom name is required");
    }

    // Get active academic year if not supplied
    let yearId = academicYearId;
    if (!yearId) {
      const activeYear = await AcademicYear.findOne({ orgId: req.orgId, isActive: true })
        .select("_id")
        .lean();
      if (activeYear) yearId = activeYear._id;
    }

    const classroom = await Classroom.create({
      orgId: req.orgId,
      academicYearId: yearId || null,
      name: name.trim(),
      level: (level || name).trim(),
      classTeacherId: classTeacherId || null,
      capacity: parseInt(capacity) || 50,
    });

    return sendSuccess(res, { classroom }, 201);
  } catch (err) {
    if (err.code === 11000)
      return sendError(
        res,
        409,
        "A classroom with this name already exists for this academic year",
        "DUPLICATE",
      );
    Logger.error("POST classrooms error", { error: err.message });
    return sendError(res, 500, "Failed to create classroom", "INTERNAL_ERROR");
  }
});

// ── GET /api/org/:orgId/classrooms ────────────────────────────────────────────

router.get("/classrooms", async (req, res) => {
  try {
    const classrooms = await Classroom.find({ orgId: req.orgId })
      .populate("classTeacherId", "fullname email")
      .sort({ level: 1, name: 1 })
      .lean();
    return sendSuccess(res, { classrooms });
  } catch (err) {
    Logger.error("GET classrooms error", { error: err.message });
    return sendError(res, 500, "Failed to load classrooms", "INTERNAL_ERROR");
  }
});

// ── GET /api/org/:orgId/classrooms/:classId/students ─────────────────────────
// Teachers + admins can see the class roster.

router.get("/classrooms/:classId/students", async (req, res) => {
  try {
    const classroom = await Classroom.findOne({
      _id: req.params.classId,
      orgId: req.orgId,
    }).lean();
    if (!classroom) return sendError(res, 404, "Classroom not found", "NOT_FOUND");

    const students = await User.find({
      _id: { $in: classroom.studentIds || [] },
      organizationId: req.orgId,
    })
      .select("fullname email username classId orgRole accountStatus isActive")
      .sort({ fullname: 1 })
      .lean();

    return sendSuccess(res, { students, classId: classroom._id, className: classroom.name });
  } catch (err) {
    Logger.error("GET classrooms/:classId/students error", { error: err.message });
    return sendError(res, 500, "Failed to load class students", "INTERNAL_ERROR");
  }
});

// ── POST /api/org/:orgId/classrooms/:classId/enroll ──────────────────────────
// Add students to a classroom. Accepts { studentIds: [userId, ...] }.

router.post("/classrooms/:classId/enroll", requireITAdmin, async (req, res) => {
  try {
    const { studentIds, reason } = req.body;
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return sendError(res, 400, "studentIds array is required");
    }

    const classroom = await Classroom.findOne({ _id: req.params.classId, orgId: req.orgId });
    if (!classroom) return sendError(res, 404, "Classroom not found", "NOT_FOUND");

    // Verify all students belong to this org and fetch classId
    const students = await User.find({
      _id: { $in: studentIds },
      organizationId: req.orgId,
      orgRole: "student",
    }).select("_id classId");

    const newIds = []; // Direct enrollments (no previous class)
    const moveIds = []; // Direct moves (owner/org_admin)
    const requestIds = []; // Require approval (it_admin)

    for (const student of students) {
      if (classroom.studentIds.map(s => s.toString()).includes(student._id.toString())) {
        continue; // already in this class
      }

      if (!student.classId) {
        newIds.push(student._id);
      } else {
        // Needs a move
        if (req.user.orgRole === "it_admin") {
          requestIds.push(student);
        } else {
          moveIds.push(student);
        }
      }
    }

    if (newIds.length === 0 && moveIds.length === 0 && requestIds.length === 0) {
      return sendSuccess(res, { message: "All students are already enrolled", enrolled: 0 });
    }

    // Check capacity for direct enrolls and moves
    const currentCount = classroom.studentIds.length;
    const incomingCount = newIds.length + moveIds.length;
    if (currentCount + incomingCount > classroom.capacity) {
      return sendError(
        res,
        400,
        `Capacity exceeded. Class has ${currentCount}/${classroom.capacity} students, cannot add ${incomingCount} more${requestIds.length > 0 ? " (not counting " + requestIds.length + " requests)" : ""}.`,
        "CAPACITY_EXCEEDED",
      );
    }

    // Execute direct enrolls & moves
    if (incomingCount > 0) {
      const allDirectIds = [...newIds, ...moveIds.map(s => s._id)];

      // Disconnect directly moving students from their old classrooms
      for (const moveStudent of moveIds) {
        await Classroom.findByIdAndUpdate(moveStudent.classId, {
          $pull: { studentIds: moveStudent._id }
        });
      }

      classroom.studentIds.push(...allDirectIds.map((id) => new mongoose.Types.ObjectId(id)));
      await classroom.save();

      // Update students' classId field
      await User.updateMany({ _id: { $in: allDirectIds } }, { $set: { classId: classroom._id } });

      Logger.info("Students enrolled/moved in classroom", {
        orgId: req.orgId,
        classId: classroom._id,
        enrolled: newIds.length,
        moved: moveIds.length
      });
    }

    // Process MoveRequests for it_admin
    if (requestIds.length > 0) {
      // Don't create duplicates if there's already a pending request for this target class
      for (const student of requestIds) {
        const existing = await MoveRequest.findOne({
          studentId: student._id,
          targetClassId: classroom._id,
          status: 'pending'
        });
        
        if (!existing) {
          await MoveRequest.create({
            orgId: req.orgId,
            studentId: student._id,
            sourceClassId: student.classId,
            targetClassId: classroom._id,
            requestedBy: req.user.id,
            status: "pending",
            reason: reason || "",
          });
        }
      }
    }

    let message = "";
    if (incomingCount > 0) {
      message += `${incomingCount} student(s) enrolled in ${classroom.name}. `;
    }
    if (requestIds.length > 0) {
      message += `${requestIds.length} move request(s) sent for Principal approval.`;
    }

    return sendSuccess(res, {
      enrolled: incomingCount,
      requestsSent: requestIds.length,
      totalStudents: classroom.studentIds.length,
      message: message.trim(),
    });
  } catch (err) {
    Logger.error("POST classrooms/:classId/enroll error", { error: err.message });
    return sendError(res, 500, "Failed to enroll students", "INTERNAL_ERROR");
  }
});

// ── PATCH /api/org/:orgId/classrooms/:classId ────────────────────────────────
// Update classroom name, teacher, capacity. IT Admin or Org Admin only.

router.patch("/classrooms/:classId", requireITAdmin, async (req, res) => {
  try {
    const classroom = await Classroom.findOne({ _id: req.params.classId, orgId: req.orgId });
    if (!classroom) return sendError(res, 404, "Classroom not found", "NOT_FOUND");

    const { name, classTeacherId, capacity, level, isActive } = req.body;
    if (name !== undefined) classroom.name = name.trim();
    if (level !== undefined) classroom.level = level.trim();
    if (classTeacherId !== undefined) classroom.classTeacherId = classTeacherId || null;
    if (capacity !== undefined) classroom.capacity = Number(capacity);
    if (isActive !== undefined) classroom.isActive = Boolean(isActive);

    await classroom.save();
    return sendSuccess(res, { classroom });
  } catch (err) {
    if (err.code === 11000)
      return sendError(res, 409, "Classroom name already exists for this year", "DUPLICATE");
    Logger.error("PATCH classrooms/:classId error", { error: err.message });
    return sendError(res, 500, "Failed to update classroom", "INTERNAL_ERROR");
  }
});

// ── POST /api/org/:orgId/classrooms/:classId/promote ─────────────────────────
// Promote all students in this class to a target class (end-of-year migration).

router.post("/classrooms/:classId/promote", requireOrgAdmin, async (req, res) => {
  try {
    const { targetClassId } = req.body;
    if (!targetClassId) return sendError(res, 400, "targetClassId is required");

    const sourceClass = await Classroom.findOne({ _id: req.params.classId, orgId: req.orgId });
    if (!sourceClass) return sendError(res, 404, "Source classroom not found", "NOT_FOUND");

    const targetClass = await Classroom.findOne({ _id: targetClassId, orgId: req.orgId });
    if (!targetClass) return sendError(res, 404, "Target classroom not found", "NOT_FOUND");

    const studentIds = sourceClass.studentIds || [];
    if (studentIds.length === 0) return sendError(res, 400, "No students to promote");

    // Capacity check
    const currentCount = (targetClass.studentIds || []).length;
    if (currentCount + studentIds.length > targetClass.capacity) {
      return sendError(
        res,
        400,
        `Target class would exceed capacity (${targetClass.capacity})`,
        "CAPACITY_EXCEEDED",
      );
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // Add to target, remove from source
      targetClass.studentIds.push(...studentIds);
      sourceClass.studentIds = [];
      await targetClass.save({ session });
      await sourceClass.save({ session });

      // Update each student's classId
      await User.updateMany(
        { _id: { $in: studentIds } },
        { $set: { classId: targetClass._id } },
        { session },
      );

      await session.commitTransaction();
      Logger.info("Students promoted", {
        orgId: req.orgId,
        from: sourceClass.name,
        to: targetClass.name,
        count: studentIds.length,
      });
      return sendSuccess(res, {
        promoted: studentIds.length,
        from: sourceClass.name,
        to: targetClass.name,
      });
    } catch (txErr) {
      await session.abortTransaction();
      throw txErr;
    } finally {
      session.endSession();
    }
  } catch (err) {
    Logger.error("POST classrooms/:classId/promote error", { error: err.message });
    return sendError(res, 500, "Failed to promote students", "INTERNAL_ERROR");
  }
});

// ── POST /api/org/:orgId/subjects ─────────────────────────────────────────────

router.post("/subjects", requireOrgAdmin, async (req, res) => {
  try {
    const { name, code, description } = req.body;
    if (!name || typeof name !== "string" || name.trim().length < 1) {
      return sendError(res, 400, "Subject name is required");
    }

    const subject = await Subject.create({
      orgId: req.orgId,
      name: name.trim(),
      code: code ? code.trim().toUpperCase() : undefined,
      description: description ? description.trim() : undefined,
      isActive: true,
    });

    return sendSuccess(res, { subject }, 201);
  } catch (err) {
    if (err.code === 11000)
      return sendError(res, 409, "A subject with this name already exists", "DUPLICATE");
    Logger.error("POST subjects error", { error: err.message });
    return sendError(res, 500, "Failed to create subject", "INTERNAL_ERROR");
  }
});

// ── GET /api/org/:orgId/subjects ──────────────────────────────────────────────

router.get("/subjects", async (req, res) => {
  try {
    const subjects = await Subject.find({ orgId: req.orgId, isActive: true })
      .sort({ name: 1 })
      .lean();
    return sendSuccess(res, { subjects });
  } catch (err) {
    Logger.error("GET subjects error", { error: err.message });
    return sendError(res, 500, "Failed to load subjects", "INTERNAL_ERROR");
  }
});

// ── POST /api/org/:orgId/subjects/:subjectId/enable-sharing ──────────────────
// Toggle question bank sharing between teachers of the same subject.

router.post("/subjects/:subjectId/enable-sharing", requireOrgAdmin, async (req, res) => {
  try {
    const subject = await Subject.findOne({ _id: req.params.subjectId, orgId: req.orgId });
    if (!subject) return sendError(res, 404, "Subject not found", "NOT_FOUND");

    subject.sharingEnabled = !subject.sharingEnabled;
    await subject.save();

    Logger.info("Subject sharing toggled", {
      orgId: req.orgId,
      subjectId: subject._id,
      sharingEnabled: subject.sharingEnabled,
    });
    return sendSuccess(res, {
      subject,
      message: `Question sharing ${subject.sharingEnabled ? "enabled" : "disabled"} for ${subject.name}`,
    });
  } catch (err) {
    Logger.error("POST subjects/:subjectId/enable-sharing error", { error: err.message });
    return sendError(res, 500, "Failed to toggle sharing", "INTERNAL_ERROR");
  }
});

// ── PATCH /api/org/:orgId/subjects/:subjectId ────────────────────────────────
// Update subject name, code, description, or deactivate.

router.patch("/subjects/:subjectId", requireOrgAdmin, async (req, res) => {
  try {
    const subject = await Subject.findOne({ _id: req.params.subjectId, orgId: req.orgId });
    if (!subject) return sendError(res, 404, "Subject not found", "NOT_FOUND");

    const { name, code, description, isActive } = req.body;
    if (name !== undefined) subject.name = name.trim();
    if (code !== undefined) subject.code = code ? code.trim().toUpperCase() : null;
    if (description !== undefined)
      subject.description = description ? description.trim() : null;
    if (isActive !== undefined) subject.isActive = Boolean(isActive);

    await subject.save();
    return sendSuccess(res, { subject });
  } catch (err) {
    if (err.code === 11000)
      return sendError(res, 409, "Subject name already exists", "DUPLICATE");
    Logger.error("PATCH subjects/:subjectId error", { error: err.message });
    return sendError(res, 500, "Failed to update subject", "INTERNAL_ERROR");
  }
});

// ── POST /api/org/:orgId/invites/bulk ─────────────────────────────────────────
// Accepts a JSON array of { email, orgRole } objects and queues a BullMQ job.
// Returns a jobId; client polls /api/ai/job-status/:jobId (reuse existing SSE).

router.post("/invites/bulk", requireITAdmin, async (req, res) => {
  try {
    const { invites } = req.body;
    if (!Array.isArray(invites) || invites.length === 0) {
      return sendError(res, 400, "invites must be a non-empty array");
    }
    if (invites.length > 500) {
      return sendError(res, 400, "Maximum 500 invites per bulk job");
    }

    // Validate each row
    const invalid = [];
    invites.forEach((row, i) => {
      if (!row.email || !isValidEmail(row.email)) invalid.push(`Row ${i + 1}: invalid email`);
      if (!row.orgRole || !VALID_INVITE_ROLES.includes(row.orgRole))
        invalid.push(`Row ${i + 1}: invalid orgRole`);
    });
    if (invalid.length > 0) {
      return sendError(
        res,
        400,
        invalid.slice(0, 5).join("; ") +
          (invalid.length > 5 ? ` ... and ${invalid.length - 5} more` : ""),
      );
    }

    // Lazy-require the bulk invite worker queue
    const { bulkInviteQueue } = require("../workers/bulkInviteWorker");

    const job = await bulkInviteQueue.add("bulk-invite", {
      orgId: req.orgId.toString(),
      invitedBy: req.user.id,
      invites,
    });

    Logger.info("Bulk invite job queued", {
      jobId: job.id,
      orgId: req.orgId,
      count: invites.length,
    });

    return sendSuccess(
      res,
      { jobId: job.id, count: invites.length, message: "Bulk invite job queued" },
      202,
    );
  } catch (err) {
    Logger.error("POST invites/bulk error", { error: err.message });
    return sendError(res, 500, "Failed to queue bulk invite job", "INTERNAL_ERROR");
  }
});

// ─── Subject Assignment Endpoints ──────────────────────────────────────────────

// POST /api/org/:orgId/subjects/assign - Assign teacher to subject/class/term
router.post("/subjects/assign", requireITAdmin, async (req, res) => {
  try {
    const { teacherId, subjectId, classId, termId } = req.body;

    if (!teacherId || !subjectId || !classId || !termId) {
      return sendError(res, 400, "teacherId, subjectId, classId, and termId are required");
    }

    // Verify teacher is in the org
    const teacher = await User.findOne({
      _id: teacherId,
      organizationId: req.orgId,
      orgRole: "teacher",
    }).lean();

    if (!teacher) {
      return sendError(
        res,
        404,
        "Teacher not found in this organisation",
        "TEACHER_NOT_FOUND",
      );
    }

    // Verify subject, class, term exist in org
    const [subject, classroom, term] = await Promise.all([
      Subject.findOne({ _id: subjectId, orgId: req.orgId }).lean(),
      Classroom.findOne({ _id: classId, orgId: req.orgId }).lean(),
      Term.findOne({ _id: termId, orgId: req.orgId }).lean(),
    ]);

    if (!subject) return sendError(res, 404, "Subject not found", "SUBJECT_NOT_FOUND");
    if (!classroom) return sendError(res, 404, "Classroom not found", "CLASSROOM_NOT_FOUND");
    if (!term) return sendError(res, 404, "Term not found", "TERM_NOT_FOUND");

    const assignment = await SubjectAssignment.findOneAndUpdate(
      { orgId: req.orgId, teacherId, subjectId, classId, termId },
      {
        $set: { isActive: true },
        $setOnInsert: { orgId: req.orgId, teacherId, subjectId, classId, termId },
      },
      { upsert: true, new: true },
    );

    Logger.info("Subject assignment created", {
      assignmentId: assignment._id,
      teacherId,
      subjectId,
      classId,
      termId,
    });

    return sendSuccess(res, { assignment }, 201);
  } catch (err) {
    Logger.error("POST /subjects/assign error", { error: err.message });
    return sendError(res, 500, "Failed to assign teacher", "INTERNAL_ERROR");
  }
});

// GET /api/org/:orgId/subjects/my-assignments - Teacher's own assignments
router.get("/subjects/my-assignments", requireTeacher, async (req, res) => {
  try {
    const { termId } = req.query;
    const query = { orgId: req.orgId, teacherId: req.user._id, isActive: true };
    if (termId) query.termId = termId;

    const assignments = await SubjectAssignment.find(query)
      .populate("teacherId", "fullname email")
      .populate("subjectId", "name code")
      .populate("classId", "name level")
      .populate("termId", "name startDate endDate")
      .lean();

    return sendSuccess(res, { assignments, total: assignments.length });
  } catch (err) {
    Logger.error("GET /subjects/my-assignments error", { error: err.message });
    return sendError(res, 500, "Failed to fetch assignments", "INTERNAL_ERROR");
  }
});

// GET /api/org/:orgId/subjects/assignments - List all subject assignments (admin)
router.get("/subjects/assignments", requireITAdmin, async (req, res) => {
  try {
    const { termId, classId, teacherId } = req.query;
    const query = { orgId: req.orgId, isActive: true };
    if (termId) query.termId = termId;
    if (classId) query.classId = classId;
    if (teacherId) query.teacherId = teacherId;

    const assignments = await SubjectAssignment.find(query)
      .populate("teacherId", "fullname email")
      .populate("subjectId", "name code")
      .populate("classId", "name level")
      .populate("termId", "name")
      .lean();

    return sendSuccess(res, { assignments, total: assignments.length });
  } catch (err) {
    Logger.error("GET /subjects/assignments error", { error: err.message });
    return sendError(res, 500, "Failed to fetch subject assignments", "INTERNAL_ERROR");
  }
});

// DELETE /api/org/:orgId/subjects/assignments/:id - Deactivate subject assignment
router.delete("/subjects/assignments/:id", requireITAdmin, async (req, res) => {
  try {
    const assignment = await SubjectAssignment.findOneAndUpdate(
      { _id: req.params.id, orgId: req.orgId },
      { $set: { isActive: false } },
      { new: true },
    );

    if (!assignment) {
      return sendError(res, 404, "Assignment not found", "NOT_FOUND");
    }

    Logger.info("Subject assignment deactivated", { assignmentId: assignment._id });
    return sendSuccess(res, { message: "Subject assignment removed" });
  } catch (err) {
    Logger.error("DELETE /subjects/assignments/:id error", { error: err.message });
    return sendError(res, 500, "Failed to remove assignment", "INTERNAL_ERROR");
  }
});

// ── GET /api/org/:orgId/move-requests ──────────────────────────────────────────
router.get("/move-requests", requireOrgAdmin, async (req, res) => {
  try {
    const requests = await MoveRequest.find({ orgId: req.orgId })
      .populate("studentId", "fullname email")
      .populate("sourceClassId", "name")
      .populate("targetClassId", "name")
      .populate("requestedBy", "fullname email")
      .sort({ createdAt: -1 })
      .lean();

    return sendSuccess(res, { requests });
  } catch (err) {
    Logger.error("GET /move-requests error", { error: err.message });
    return sendError(res, 500, "Failed to fetch move requests", "INTERNAL_ERROR");
  }
});

// ── PATCH /api/org/:orgId/move-requests/:requestId/approve ───────────────────
router.patch("/move-requests/:requestId/approve", requireOrgAdmin, async (req, res) => {
  try {
    const moveRequest = await MoveRequest.findOne({ _id: req.params.requestId, orgId: req.orgId });
    if (!moveRequest) return sendError(res, 404, "Move request not found", "NOT_FOUND");
    if (moveRequest.status !== "pending") return sendError(res, 400, "Request is not pending", "INVALID_STATUS");

    // Remove from source class
    if (moveRequest.sourceClassId) {
      await Classroom.findByIdAndUpdate(moveRequest.sourceClassId, {
        $pull: { studentIds: moveRequest.studentId }
      });
    }

    // Add to target class
    await Classroom.findByIdAndUpdate(moveRequest.targetClassId, {
      $addToSet: { studentIds: moveRequest.studentId }
    });

    // Update student's classId
    await User.findByIdAndUpdate(moveRequest.studentId, {
      $set: { classId: moveRequest.targetClassId }
    });

    moveRequest.status = "approved";
    moveRequest.actionedBy = req.user.id;
    await moveRequest.save();

    Logger.info("Move request approved", { requestId: moveRequest._id, actionedBy: req.user.id });
    return sendSuccess(res, { message: "Move request approved successfully.", moveRequest });
  } catch (err) {
    Logger.error("PATCH /move-requests/approve error", { error: err.message });
    return sendError(res, 500, "Failed to approve move request", "INTERNAL_ERROR");
  }
});

// ── PATCH /api/org/:orgId/move-requests/:requestId/reject ────────────────────
router.patch("/move-requests/:requestId/reject", requireOrgAdmin, async (req, res) => {
  try {
    const moveRequest = await MoveRequest.findOne({ _id: req.params.requestId, orgId: req.orgId });
    if (!moveRequest) return sendError(res, 404, "Move request not found", "NOT_FOUND");
    if (moveRequest.status !== "pending") return sendError(res, 400, "Request is not pending", "INVALID_STATUS");

    moveRequest.status = "rejected";
    moveRequest.actionedBy = req.user.id;
    await moveRequest.save();

    Logger.info("Move request rejected", { requestId: moveRequest._id, actionedBy: req.user.id });
    return sendSuccess(res, { message: "Move request rejected.", moveRequest });
  } catch (err) {
    Logger.error("PATCH /move-requests/reject error", { error: err.message });
    return sendError(res, 500, "Failed to reject move request", "INTERNAL_ERROR");
  }
});

// ── GET /api/org/:orgId/grading-settings ──────────────────────────────────────
// Returns caWeight, scoreComponents, and gradeBoundaries for this org.
// Any org member can read; only owner/org_admin can write.

router.get("/grading-settings", async (req, res) => {
  try {
    const org = await Organization.findById(req.orgId)
      .select("settings.caWeight settings.examWeight settings.scoreComponents settings.gradeBoundaries")
      .lean();
    if (!org) return sendError(res, 404, "Organisation not found", "ORG_NOT_FOUND");
    return sendSuccess(res, { gradingSettings: org.settings });
  } catch (err) {
    Logger.error("GET grading-settings error", { error: err.message });
    return sendError(res, 500, "Failed to load grading settings", "INTERNAL_ERROR");
  }
});

// ── PUT /api/org/:orgId/grading-settings ──────────────────────────────────────
// Update caWeight, scoreComponents, and/or gradeBoundaries for this org.
// Restricted to owner / org_admin.

router.put("/grading-settings", requireOrgAdmin, async (req, res) => {
  try {
    const { caWeight, scoreComponents, gradeBoundaries } = req.body;

    const update = {};

    // Validate & apply caWeight
    if (caWeight !== undefined) {
      const w = Number(caWeight);
      if (isNaN(w) || w < 0 || w > 100) {
        return sendError(res, 400, "caWeight must be a number between 0 and 100");
      }
      update["settings.caWeight"] = w;
      update["settings.examWeight"] = 100 - w;
    }

    // Validate & apply scoreComponents
    if (scoreComponents !== undefined) {
      if (!Array.isArray(scoreComponents) || scoreComponents.length === 0) {
        return sendError(res, 400, "scoreComponents must be a non-empty array");
      }
      for (const c of scoreComponents) {
        if (!c.name || typeof c.name !== "string" || !c.name.trim()) {
          return sendError(res, 400, "Each score component must have a non-empty name");
        }
        if (!c.maxScore || Number(c.maxScore) < 1) {
          return sendError(res, 400, `Component "${c.name}" must have a maxScore >= 1`);
        }
      }
      update["settings.scoreComponents"] = scoreComponents.map((c, i) => ({
        name: c.name.trim(),
        maxScore: Number(c.maxScore),
        isExam: Boolean(c.isExam),
        order: c.order !== undefined ? Number(c.order) : i,
      }));
    }

    // Validate & apply gradeBoundaries
    if (gradeBoundaries !== undefined) {
      if (!Array.isArray(gradeBoundaries) || gradeBoundaries.length === 0) {
        return sendError(res, 400, "gradeBoundaries must be a non-empty array");
      }
      for (const b of gradeBoundaries) {
        if (!b.grade || typeof b.grade !== "string") {
          return sendError(res, 400, "Each boundary must have a grade label");
        }
        if (b.min === undefined || b.max === undefined || Number(b.min) > Number(b.max)) {
          return sendError(res, 400, `Boundary "${b.grade}": min must be <= max`);
        }
        if (!b.remark || typeof b.remark !== "string") {
          return sendError(res, 400, `Boundary "${b.grade}" must have a remark`);
        }
      }
      update["settings.gradeBoundaries"] = gradeBoundaries.map((b) => ({
        grade: b.grade.trim(),
        min: Number(b.min),
        max: Number(b.max),
        remark: b.remark.trim(),
        points: Number(b.points) || 0,
      }));
    }

    if (Object.keys(update).length === 0) {
      return sendError(res, 400, "No valid settings provided to update");
    }

    await Organization.findByIdAndUpdate(req.orgId, { $set: update });

    // Bust the GradeBook in-memory cache so grades recompute immediately
    try {
      const { bustOrgSettingsCache } = require("../models/GradeBook");
      bustOrgSettingsCache(req.orgId);
    } catch (_) { /* non-fatal */ }

    AuditLog.create({
      userId: req.user.id,
      action: "grading_settings_updated",
      orgId: req.orgId,
      details: { updated: Object.keys(update) },
      ip: req.ip,
    }).catch(() => {});

    Logger.info("Grading settings updated", { orgId: req.orgId, keys: Object.keys(update) });

    const refreshed = await Organization.findById(req.orgId)
      .select("settings.caWeight settings.examWeight settings.scoreComponents settings.gradeBoundaries")
      .lean();

    return sendSuccess(res, {
      message: "Grading settings updated successfully",
      gradingSettings: refreshed?.settings,
    });
  } catch (err) {
    Logger.error("PUT grading-settings error", { error: err.message });
    return sendError(res, 500, "Failed to update grading settings", "INTERNAL_ERROR");
  }
});

// ── PATCH /api/org/:orgId/branding ───────────────────────────────────────────
// Update org branding (owner / org_admin only).
// Accepted fields: logoUrl, faviconUrl, primaryColor, accentColor,
//                  displayName, tagline, loginHeroText, hideVayrexBranding
router.patch("/branding", requireOrgAdmin, async (req, res) => {
  try {
    const ALLOWED = [
      "logoUrl", "faviconUrl", "primaryColor", "accentColor",
      "displayName", "tagline", "loginHeroText", "hideVayrexBranding",
    ];
    const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

    const update = {};
    for (const key of ALLOWED) {
      if (req.body[key] === undefined) continue;
      const val = req.body[key];

      if (key === "hideVayrexBranding") {
        // Enterprise flag — only owner can change it
        if (req.user.orgRole !== "owner") continue;
        update[`branding.${key}`] = Boolean(val);
        continue;
      }
      if (key === "primaryColor" || key === "accentColor") {
        if (typeof val !== "string" || !COLOR_RE.test(val.trim())) {
          return sendError(res, 400, `Invalid colour value for ${key}`, "VALIDATION_ERROR");
        }
        update[`branding.${key}`] = val.trim();
        continue;
      }
      // String fields — null clears, string sets
      if (val !== null && typeof val !== "string") {
        return sendError(res, 400, `${key} must be a string or null`, "VALIDATION_ERROR");
      }
      update[`branding.${key}`] = val === null ? null : val.trim().slice(0, 500);
    }

    if (Object.keys(update).length === 0) {
      return sendError(res, 400, "No valid branding fields provided", "VALIDATION_ERROR");
    }

    const org = await Organization.findByIdAndUpdate(
      req.orgId,
      { $set: update },
      { new: true, select: "branding name slug subdomain" }
    ).lean();

    if (!org) return sendError(res, 404, "Organisation not found", "NOT_FOUND");

    // Invalidate public org-by-host cache so next page load sees new branding
    try {
      const publicRouter = require("./public");
      publicRouter.invalidateCache(org.subdomain);
    } catch (_) { /* non-fatal */ }

    // Also invalidate subdomainGuard cache
    try {
      const subdomainGuard = require("../middleware/subdomainGuard");
      subdomainGuard.invalidateCache(org.subdomain);
    } catch (_) { /* non-fatal */ }

    AuditLog.create({
      userId: req.user.id,
      action: "branding_updated",
      orgId: req.orgId,
      details: { updatedFields: Object.keys(update) },
      ip: req.ip,
    }).catch(() => {});

    Logger.info("Branding updated", { orgId: req.orgId, fields: Object.keys(update) });

    return sendSuccess(res, { message: "Branding updated", branding: org.branding });
  } catch (err) {
    Logger.error("PATCH branding error", { error: err.message });
    return sendError(res, 500, "Failed to update branding", "INTERNAL_ERROR");
  }
});

// ── GET /api/org/:orgId/branding ─────────────────────────────────────────────
router.get("/branding", async (req, res) => {
  try {
    const org = await Organization.findById(req.orgId).select("branding name slug").lean();
    if (!org) return sendError(res, 404, "Organisation not found", "NOT_FOUND");
    return sendSuccess(res, { branding: org.branding });
  } catch (err) {
    Logger.error("GET branding error", { error: err.message });
    return sendError(res, 500, "Failed to fetch branding", "INTERNAL_ERROR");
  }
});

module.exports = router;

