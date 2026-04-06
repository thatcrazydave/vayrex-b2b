/**
 * B2B Announcement Routes
 *
 * All routes scoped to /api/org/:orgId/announcements
 *
 * POST /                 - Create announcement (teacher: class scope; admin: any scope)
 * GET  /                 - List announcements for the current user
 * GET  /:id              - Get single announcement
 * PATCH /:id             - Update announcement (creator only)
 * DELETE /:id            - Delete announcement (creator or admin)
 */

"use strict";
const router = require("express").Router({ mergeParams: true });

const Announcement = require("../models/Announcement");
const Classroom = require("../models/Classroom");
const User = require("../models/User");
const Logger = require("../logger");

const { authenticateToken } = require("../middleware/auth");
const { requireOrgMember, requireOrgRole } = require("../middleware/orgAuth");

function sendError(res, status, message, code = "VALIDATION_ERROR") {
  return res.status(status).json({ success: false, error: { code, message } });
}
function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

router.use(authenticateToken, requireOrgMember);

// ── POST /api/org/:orgId/announcements ────────────────────────────
router.post("/", requireOrgRole("owner", "org_admin", "teacher"), async (req, res) => {
  try {
    const { scope, targetClassIds, targetUserIds, title, body, attachmentUrl, expiresAt } =
      req.body;
    const user = req.user;

    if (!title || !scope) {
      return sendError(res, 400, "title and scope are required");
    }

    const validScopes = ["school", "class", "teacher-broadcast", "user"];
    if (!validScopes.includes(scope)) {
      return sendError(res, 400, `Invalid scope. Must be one of: ${validScopes.join(", ")}`);
    }

    // Teachers can only use class or teacher-broadcast scope
    if (user.orgRole === "teacher" && !["class", "teacher-broadcast"].includes(scope)) {
      return sendError(
        res,
        403,
        "Teachers can only create class or teacher-broadcast announcements",
        "FORBIDDEN",
      );
    }

    // Build recipient list
    let recipientList = [];

    if (scope === "school") {
      // All org members
      const members = await User.find({
        organizationId: req.orgId,
        accountStatus: "active",
      })
        .select("_id")
        .lean();
      recipientList = members.map((m) => m._id);
    } else if (scope === "class") {
      if (!targetClassIds || targetClassIds.length === 0) {
        return sendError(res, 400, "targetClassIds required for class scope");
      }
      // All students + teachers in the specified classes
      const students = await User.find({
        organizationId: req.orgId,
        classId: { $in: targetClassIds },
        accountStatus: "active",
      })
        .select("_id")
        .lean();
      recipientList = students.map((m) => m._id);
    } else if (scope === "teacher-broadcast") {
      // All teachers in the org
      const teachers = await User.find({
        organizationId: req.orgId,
        orgRole: "teacher",
        accountStatus: "active",
      })
        .select("_id")
        .lean();
      recipientList = teachers.map((m) => m._id);
    } else if (scope === "user") {
      if (!targetUserIds || targetUserIds.length === 0) {
        return sendError(res, 400, "targetUserIds required for user scope");
      }
      recipientList = targetUserIds;
    }

    const announcement = await Announcement.create({
      orgId: req.orgId,
      createdBy: user._id,
      scope,
      targetClassIds: targetClassIds || [],
      targetUserIds: targetUserIds || [],
      recipientList,
      title: title.trim(),
      body: (body || "").trim(),
      attachmentUrl: attachmentUrl || "",
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      isActive: true,
    });

    Logger.info("Announcement created", {
      announcementId: announcement._id,
      scope,
      recipientCount: recipientList.length,
      createdBy: user._id,
    });

    return sendSuccess(res, { announcement }, 201);
  } catch (err) {
    Logger.error("POST /announcements error", { error: err.message });
    return sendError(res, 500, "Failed to create announcement", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/announcements ─────────────────────────────
// List announcements for the current user (based on recipientList)
router.get("/", async (req, res) => {
  try {
    const user = req.user;
    const { limit = 20, skip = 0 } = req.query;

    const announcements = await Announcement.find({
      orgId: req.orgId,
      recipientList: user._id,
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    })
      .populate("createdBy", "name orgRole")
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit))
      .lean();

    return sendSuccess(res, { announcements, total: announcements.length });
  } catch (err) {
    Logger.error("GET /announcements error", { error: err.message });
    return sendError(res, 500, "Failed to fetch announcements", "SERVER_ERROR");
  }
});

// ── GET /api/org/:orgId/announcements/:id ─────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      orgId: req.orgId,
      recipientList: req.user._id,
    })
      .populate("createdBy", "name orgRole")
      .lean();

    if (!announcement) {
      return sendError(res, 404, "Announcement not found", "NOT_FOUND");
    }

    return sendSuccess(res, { announcement });
  } catch (err) {
    Logger.error("GET /announcements/:id error", { error: err.message });
    return sendError(res, 500, "Failed to fetch announcement", "SERVER_ERROR");
  }
});

// ── PATCH /api/org/:orgId/announcements/:id ───────────────────────
router.patch("/:id", requireOrgRole("owner", "org_admin", "teacher"), async (req, res) => {
  try {
    const user = req.user;
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      orgId: req.orgId,
    });

    if (!announcement) {
      return sendError(res, 404, "Announcement not found", "NOT_FOUND");
    }

    // Teachers can only edit their own
    if (
      user.orgRole === "teacher" &&
      announcement.createdBy.toString() !== user._id.toString()
    ) {
      return sendError(res, 403, "You can only edit your own announcements", "FORBIDDEN");
    }

    const allowed = ["title", "body", "attachmentUrl", "isActive", "expiresAt"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        announcement[key] = req.body[key];
      }
    }

    await announcement.save();
    return sendSuccess(res, { announcement });
  } catch (err) {
    Logger.error("PATCH /announcements/:id error", { error: err.message });
    return sendError(res, 500, "Failed to update announcement", "SERVER_ERROR");
  }
});

// ── DELETE /api/org/:orgId/announcements/:id ──────────────────────
router.delete("/:id", requireOrgRole("owner", "org_admin", "teacher"), async (req, res) => {
  try {
    const user = req.user;
    const announcement = await Announcement.findOne({
      _id: req.params.id,
      orgId: req.orgId,
    });

    if (!announcement) {
      return sendError(res, 404, "Announcement not found", "NOT_FOUND");
    }

    if (
      user.orgRole === "teacher" &&
      announcement.createdBy.toString() !== user._id.toString()
    ) {
      return sendError(res, 403, "You can only delete your own announcements", "FORBIDDEN");
    }

    announcement.isActive = false;
    await announcement.save();

    Logger.info("Announcement deactivated", {
      announcementId: announcement._id,
      deletedBy: user._id,
    });

    return sendSuccess(res, { message: "Announcement deleted" });
  } catch (err) {
    Logger.error("DELETE /announcements/:id error", { error: err.message });
    return sendError(res, 500, "Failed to delete announcement", "SERVER_ERROR");
  }
});

module.exports = router;
