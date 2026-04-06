/**
 * orgAuth.js
 *
 * RBAC + ABAC middleware for the B2B org layer.
 *
 * Middleware stack (run in order):
 *   authenticateToken → subdomainGuard → requireOrgMember → [specific role check] → handler
 *
 * All middleware here assumes:
 *   - req.user is set (authenticateToken ran)
 *   - req.org is set (subdomainGuard ran) when on a subdomain
 */

const SubjectAssignment = require("../models/SubjectAssignment");
const Logger = require("../logger");

// ─── Helper: standardised 403 response ────────────────────────
function forbidden(res, code, message) {
  return res.status(403).json({
    success: false,
    error: {
      code,
      message,
      timestamp: new Date().toISOString(),
    },
  });
}

// ─── Org membership check ──────────────────────────────────────
/**
 * requireOrgMember
 * Verifies:
 *   1. User has an organizationId (is part of an org)
 *   2. User's organizationId matches the active org from subdomainGuard
 *   3. The org is active
 *
 * Also enforces: org in URL param :orgId (if present) matches the user's org.
 * This prevents IDOR via URL manipulation.
 */
const requireOrgMember = (req, res, next) => {
  const user = req.user;

  if (!user.organizationId) {
    return forbidden(res, "NOT_ORG_MEMBER", "You are not a member of any organisation");
  }

  if (!user.orgRole) {
    return forbidden(res, "NO_ORG_ROLE", "No organisational role assigned to your account");
  }

  // If the route has :orgId param, validate it matches the user's org
  if (req.params.orgId) {
    if (user.organizationId.toString() !== req.params.orgId) {
      Logger.warn("orgId URL param mismatch", {
        userId: user._id,
        paramOrgId: req.params.orgId,
        userOrgId: user.organizationId,
      });
      return forbidden(res, "ORG_MISMATCH", "Organisation ID does not match your account");
    }
  }

  // Attach orgId to request for downstream query scoping
  req.orgId = user.organizationId;

  next();
};

// ─── Role checkers ─────────────────────────────────────────────

/**
 * requireOrgRole(...roles)
 * Factory: returns middleware that allows access only to users with one of the given org roles.
 * Also accepts 'owner' and 'org_admin' to allow both for admin-level actions.
 *
 * Example: requireOrgRole('org_admin', 'owner')
 */
const requireOrgRole =
  (...allowedRoles) =>
  (req, res, next) => {
    const orgRole = req.user.orgRole;
    if (!orgRole || !allowedRoles.includes(orgRole)) {
      Logger.warn("Insufficient org role", {
        userId: req.user._id,
        orgRole,
        required: allowedRoles,
        path: req.path,
      });
      return forbidden(
        res,
        "INSUFFICIENT_ORG_ROLE",
        `This action requires one of the following roles: ${allowedRoles.join(", ")}`,
      );
    }
    next();
  };

// Convenience exports for common role checks
const requireOwner = requireOrgRole("owner");
const requireOrgAdmin = requireOrgRole("owner", "org_admin");
const requireITAdmin = requireOrgRole("owner", "org_admin", "it_admin");
const requireTeacher = requireOrgRole("owner", "org_admin", "teacher");
const requireStudent = requireOrgRole("student");
const requireGuardian = requireOrgRole("guardian");

// ─── ABAC checks ───────────────────────────────────────────────

/**
 * requireSubjectAssignment
 * ABAC check for teachers: verifies they have an active SubjectAssignment
 * for the { classId, subjectId, termId } combination passed in the request.
 *
 * Reads these from:
 *   req.params.classId, req.params.subjectId
 *   req.query.termId OR req.body.termId
 *
 * Bypassed for org_admin and owner who have blanket access.
 */
const requireSubjectAssignment = async (req, res, next) => {
  const user = req.user;

  // org_admin and owner bypass ABAC check
  if (user.orgRole === "owner" || user.orgRole === "org_admin") return next();

  if (user.orgRole !== "teacher") {
    return forbidden(res, "NOT_TEACHER", "Only teachers can perform this action");
  }

  const classId = req.params.classId || req.body.classId || req.query.classId;
  const subjectId = req.params.subjectId || req.body.subjectId || req.query.subjectId;
  const termId = req.params.termId || req.body.termId || req.query.termId;

  if (!classId || !subjectId || !termId) {
    return forbidden(
      res,
      "ABAC_MISSING_PARAMS",
      "classId, subjectId, and termId are required to verify teacher assignment",
    );
  }

  try {
    const assignment = await SubjectAssignment.findOne({
      teacherId: user._id,
      orgId: req.orgId,
      classId,
      subjectId,
      termId,
      isActive: true,
    }).lean();

    if (!assignment) {
      Logger.warn("Teacher ABAC check failed — no SubjectAssignment", {
        userId: user._id,
        classId,
        subjectId,
        termId,
      });
      return forbidden(
        res,
        "NOT_ASSIGNED_TO_CLASS",
        "You are not assigned to teach this subject in this class for the current term",
      );
    }

    // Attach the assignment to req for downstream use
    req.subjectAssignment = assignment;
    next();
  } catch (err) {
    Logger.error("requireSubjectAssignment error", { error: err.message });
    return res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to verify teacher assignment" },
    });
  }
};

/**
 * requireStudentInClass
 * ABAC check for students: verifies the student belongs to the class in :classId.
 * Bypassed for org_admin and owner.
 */
const requireStudentInClass = (req, res, next) => {
  const user = req.user;

  if (user.orgRole === "owner" || user.orgRole === "org_admin") return next();

  if (user.orgRole !== "student") {
    return forbidden(res, "NOT_STUDENT", "Only students can perform this action");
  }

  const classId = req.params.classId || req.body.classId || req.query.classId;

  if (!classId) {
    return forbidden(res, "ABAC_MISSING_PARAMS", "classId is required");
  }

  if (!user.classId || user.classId.toString() !== classId.toString()) {
    Logger.warn("Student ABAC check failed — classId mismatch", {
      userId: user._id,
      userClassId: user.classId,
      requestedClassId: classId,
    });
    return forbidden(res, "NOT_IN_CLASS", "You are not enrolled in this class");
  }

  next();
};

/**
 * requireGuardianOfStudent
 * ABAC check for guardians: verifies the guardian is linked to the :studentId param.
 */
const requireGuardianOfStudent = (req, res, next) => {
  const user = req.user;

  if (user.orgRole === "owner" || user.orgRole === "org_admin") return next();

  if (user.orgRole !== "guardian") {
    return forbidden(res, "NOT_GUARDIAN", "Only guardians can perform this action");
  }

  const studentId = req.params.studentId;

  if (!studentId) {
    return forbidden(res, "ABAC_MISSING_PARAMS", "studentId is required");
  }

  const isLinked = (user.guardianOf || []).some(
    (id) => id.toString() === studentId.toString(),
  );

  if (!isLinked) {
    Logger.warn("Guardian ABAC check failed — not linked to student", {
      guardianId: user._id,
      requestedStudentId: studentId,
    });
    return forbidden(res, "NOT_GUARDIAN_OF_STUDENT", "You are not linked to this student");
  }

  next();
};

/**
 * denyITAdminAcademic
 * Explicit deny for IT admins on any academic data routes.
 * IT admins can enroll users but NEVER see grades, notes, or quiz results.
 */
const denyITAdminAcademic = (req, res, next) => {
  if (req.user.orgRole === "it_admin") {
    Logger.warn("IT admin attempted academic route access", {
      userId: req.user._id,
      path: req.path,
    });
    return forbidden(
      res,
      "IT_ADMIN_ACADEMIC_DENIED",
      "IT administrators do not have access to academic data",
    );
  }
  next();
};

module.exports = {
  requireOrgMember,
  requireOrgRole,
  requireOwner,
  requireOrgAdmin,
  requireITAdmin,
  requireTeacher,
  requireStudent,
  requireGuardian,
  requireSubjectAssignment,
  requireStudentInClass,
  requireGuardianOfStudent,
  denyITAdminAcademic,
};
