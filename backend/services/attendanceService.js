"use strict";

const AttendanceRecord = require("../models/AttendanceRecord");
const Notification = require("../models/Notification");
const Organization = require("../models/Organization");
const User = require("../models/User");
const Logger = require("../logger");

let emailService;
try {
  emailService = require("./emailService");
} catch (err) {
  Logger.warn("emailService not available for attendance alerts", { error: err.message });
  emailService = null;
}

class AttendanceService {
  /**
   * Check attendance threshold for students after recording and fire alerts
   * if any student's attendance drops below the org threshold.
   *
   * @param {ObjectId} orgId
   * @param {ObjectId} classId
   * @param {ObjectId} termId
   * @param {Array<{studentId, status}>} records - the attendance entries just recorded
   */
  static async checkThresholdAlerts(orgId, classId, termId, records) {
    try {
      const org = await Organization.findById(orgId).select("settings name").lean();
      if (!org) return;

      const threshold = org.settings?.attendanceThreshold ?? 75;

      // Only check students who were marked absent or late
      const flaggedStudentIds = records
        .filter((r) => r.status === "absent" || r.status === "late")
        .map((r) => r.studentId);

      if (flaggedStudentIds.length === 0) return;

      // Compute attendance percentage for each flagged student
      const allRecords = await AttendanceRecord.find({
        orgId,
        classId,
        termId,
      })
        .select("records")
        .lean();

      for (const studentId of flaggedStudentIds) {
        let totalDays = 0;
        let presentDays = 0;

        for (const record of allRecords) {
          const entry = record.records.find(
            (r) => r.studentId.toString() === studentId.toString(),
          );
          if (entry) {
            totalDays++;
            if (entry.status === "present") presentDays++;
          }
        }

        if (totalDays === 0) continue;

        const percentage = Math.round((presentDays / totalDays) * 100);

        if (percentage < threshold) {
          await AttendanceService._sendAlert(orgId, studentId, percentage, threshold, org.name);
        }
      }
    } catch (err) {
      // Non-blocking — don't fail the attendance recording if alerts fail
      Logger.error("Attendance threshold check failed", { error: err.message, orgId, classId });
    }
  }

  /**
   * Send attendance alert: in-app notification to student + email to guardian(s)
   */
  static async _sendAlert(orgId, studentId, percentage, threshold, orgName) {
    try {
      const student = await User.findById(studentId).select("fullname email").lean();
      if (!student) return;

      const studentName = student.fullname || student.email;

      // Create in-app notification for student
      await Notification.create({
        userId: studentId,
        orgId,
        type: "attendance_below_threshold",
        title: "Attendance Alert",
        body: `Your attendance has dropped to ${percentage}%, which is below the required ${threshold}%. Please improve your attendance.`,
        actionUrl: "/student",
      });

      // Find guardian(s) linked to this student
      const guardians = await User.find({
        organizationId: orgId,
        orgRole: "guardian",
        guardianOf: studentId,
      })
        .select("email fullname")
        .lean();

      for (const guardian of guardians) {
        // In-app notification for guardian
        await Notification.create({
          userId: guardian._id,
          orgId,
          type: "attendance_below_threshold",
          title: "Child Attendance Alert",
          body: `${studentName}'s attendance has dropped to ${percentage}%, below the required ${threshold}%.`,
          actionUrl: "/guardian-portal",
        });

        // Email guardian
        if (emailService && guardian.email) {
          try {
            await emailService.sendAttendanceAlertEmail(
              guardian.email,
              guardian.fullname || "Parent/Guardian",
              studentName,
              percentage,
              threshold,
              orgName,
            );
          } catch (emailErr) {
            Logger.warn("Failed to email attendance alert to guardian", {
              guardianId: guardian._id,
              error: emailErr.message,
            });
          }
        }
      }

      Logger.info("Attendance alert sent", { studentId, percentage, threshold, guardianCount: guardians.length });
    } catch (err) {
      Logger.error("Failed to send attendance alert", { error: err.message, studentId });
    }
  }
}

module.exports = AttendanceService;
