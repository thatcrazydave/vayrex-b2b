const AuditLog = require("../models/AuditLog");
const Logger = require("../logger");

const ROUTE_ACTION_MAP = {
  "POST /members/invite": "org_member_invited",
  "POST /members/bulk-invite": "org_member_invited",
  "DELETE /members/:userId": "org_member_removed",
  "PUT /members/:userId/role": "seat_assigned",
  "PUT /members/:userId/suspend": "seat_revoked",
  "POST /classrooms": "class_created",
  "PUT /classrooms/:classId": "class_updated",
  "POST /academic-years": "term_opened",
  "POST /terms/:termId/close": "term_closed",
  "PUT /gradebook/:id/publish": "grade_published",
  "PUT /gradebook/:id/amend": "grade_amended",
  "POST /report-cards/generate": "report_card_published",
  "PUT /assignments/:id/publish": "assignment_published",
  "POST /attendance/lock": "attendance_locked",
  "POST /promotions/execute": "promotion_wizard_completed",
  "POST /guardians/link": "guardian_linked",
  "PUT /settings": "org_updated",
};

function matchAction(method, path) {
  for (const [pattern, action] of Object.entries(ROUTE_ACTION_MAP)) {
    const [patternMethod, patternPath] = pattern.split(" ");
    if (method !== patternMethod) continue;

    const regex = new RegExp("^" + patternPath.replace(/:[^/]+/g, "[^/]+") + "$");

    const strippedPath = path.replace(/^\/api\/org\/[^/]+/, "");
    if (regex.test(strippedPath)) return action;
  }
  return null;
}

function inferTargetType(action) {
  if (action.startsWith("org_member")) return "User";
  if (action.startsWith("seat_")) return "User";
  if (action.startsWith("class_")) return "Classroom";
  if (action.startsWith("term_")) return "Term";
  if (action.startsWith("grade_")) return "GradeBook";
  if (action.startsWith("report_card")) return "ReportCard";
  if (action.startsWith("assignment_")) return "Assignment";
  if (action.startsWith("attendance_")) return "AttendanceRecord";
  if (action.startsWith("promotion_")) return "Classroom";
  if (action.startsWith("guardian_")) return "User";
  if (action === "org_updated") return "Organization";
  return null;
}

function determineSeverity(action) {
  const critical = [
    "org_member_removed",
    "seat_revoked",
    "grade_amended",
    "term_closed",
    "promotion_wizard_completed",
  ];
  const warning = ["org_updated", "attendance_locked"];
  if (critical.includes(action)) return "critical";
  if (warning.includes(action)) return "warning";
  return "info";
}

function orgAuditLogger(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }

  const action = matchAction(req.method, req.path);
  if (!action) return next();

  const originalJson = res.json.bind(res);

  res.json = function (data) {
    if (data && data.success !== false) {
      AuditLog.create({
        userId: req.user?._id || req.user?.id || null,
        action,
        orgId: req.orgId || null,
        targetType: inferTargetType(action),
        targetId: req.params.id || req.params.userId || req.params.classId || null,
        details: {
          endpoint: req.path,
          method: req.method,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        severity: determineSeverity(action),
      }).catch((err) => {
        Logger.error("Org audit log error", { error: err.message, action });
      });
    }

    return originalJson(data);
  };

  next();
}

module.exports = { orgAuditLogger };
