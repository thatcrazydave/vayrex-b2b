"use strict";

const PDFDocument = require("pdfkit");
const storageService = require("./storageService");
const Logger = require("../logger");

/**
 * Generate a report card PDF buffer for a single student.
 *
 * @param {Object} reportCard - populated report card document
 * @param {Object} org - org document with name
 * @returns {Buffer} PDF buffer
 */
async function generateReportCardPDF(reportCard, org) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        bufferPages: true,
        info: {
          Title: `Report Card - ${reportCard.studentId?.name || reportCard.studentId?.fullname || "Student"}`,
          Author: org?.name || "Vayrex Learning",
          Creator: "Vayrex B2B Platform",
        },
      });

      const buffers = [];
      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const studentName =
        reportCard.studentId?.fullname || reportCard.studentId?.name || "Student";
      const className = reportCard.classId?.name || "Class";
      const termName = reportCard.termId?.name || "Term";
      const orgName = org?.name || "School";

      // ── Header ──
      doc.fontSize(18).font("Helvetica-Bold").text(orgName, { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(14).font("Helvetica").text("STUDENT REPORT CARD", { align: "center" });
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#333").lineWidth(1).stroke();
      doc.moveDown(0.5);

      // ── Student info ──
      doc.fontSize(10).font("Helvetica-Bold");
      doc.text(`Student: `, { continued: true }).font("Helvetica").text(studentName);
      doc
        .font("Helvetica-Bold")
        .text(`Class: `, { continued: true })
        .font("Helvetica")
        .text(className);
      doc
        .font("Helvetica-Bold")
        .text(`Term: `, { continued: true })
        .font("Helvetica")
        .text(termName);
      if (reportCard.classPosition) {
        doc
          .font("Helvetica-Bold")
          .text(`Position: `, { continued: true })
          .font("Helvetica")
          .text(`${reportCard.classPosition} of ${reportCard.classSize || "—"}`);
      }
      doc.moveDown(1);

      // ── Grades table ──
      const grades = reportCard.grades || [];
      if (grades.length > 0) {
        doc.fontSize(11).font("Helvetica-Bold").text("Academic Performance");
        doc.moveDown(0.5);

        const tableTop = doc.y;
        const colX = [50, 200, 270, 340, 405, 450];
        const headers = ["Subject", "CA", "Exam", "Total", "Grade", "Remark"];

        // Header row
        doc.fontSize(9).font("Helvetica-Bold");
        headers.forEach((h, i) => {
          doc.text(h, colX[i], tableTop, { width: (colX[i + 1] || 545) - colX[i] });
        });
        doc
          .moveTo(50, tableTop + 14)
          .lineTo(545, tableTop + 14)
          .strokeColor("#ccc")
          .lineWidth(0.5)
          .stroke();

        let rowY = tableTop + 20;
        doc.font("Helvetica").fontSize(9);

        for (const g of grades) {
          if (rowY > 750) {
            doc.addPage();
            rowY = 50;
          }
          const subjectName = g.subjectId?.name || g.subjectId?.code || "—";
          doc.text(subjectName, colX[0], rowY, { width: 145 });
          doc.text(String(g.caScore ?? "—"), colX[1], rowY, { width: 60 });
          doc.text(String(g.examScore ?? "—"), colX[2], rowY, { width: 60 });
          doc.text(String(g.totalScore ?? "—"), colX[3], rowY, { width: 55, align: "left" });
          doc.text(g.letterGrade || "—", colX[4], rowY, { width: 40, align: "left" });
          doc.text(g.remark || "—", colX[5], rowY, { width: 95 });
          rowY += 18;
        }

        doc.moveTo(50, rowY).lineTo(545, rowY).strokeColor("#ccc").lineWidth(0.5).stroke();
        doc.y = rowY + 10;
      }

      doc.moveDown(1);

      // ── Attendance summary ──
      const att = reportCard.attendanceSummary;
      if (att) {
        doc.fontSize(11).font("Helvetica-Bold").text("Attendance Summary");
        doc.moveDown(0.3);
        doc.fontSize(9).font("Helvetica");
        doc.text(
          `Present: ${att.present}   |   Absent: ${att.absent}   |   Late: ${att.late}   |   Excused: ${att.excused}   |   Attendance: ${att.percentage}%`,
        );
        doc.moveDown(1);
      }

      // ── Comments ──
      if (reportCard.classTeacherComment) {
        doc.fontSize(10).font("Helvetica-Bold").text("Class Teacher's Comment:");
        doc.font("Helvetica-Oblique").text(reportCard.classTeacherComment);
        doc.moveDown(0.5);
      }
      if (reportCard.principalComment) {
        doc.fontSize(10).font("Helvetica-Bold").text("Principal's Comment:");
        doc.font("Helvetica-Oblique").text(reportCard.principalComment);
        doc.moveDown(0.5);
      }

      // ── Footer ──
      doc.moveDown(2);
      doc
        .fontSize(7)
        .font("Helvetica")
        .fillColor("#999")
        .text(`Generated by Vayrex — ${new Date().toLocaleDateString()}`, { align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate a report card PDF, upload to Supabase, and return the storage key.
 *
 * @param {Object} reportCard - populated report card document
 * @param {Object} org - org document
 * @returns {{ storageKey: string, publicUrl: string }}
 */
async function generateAndUpload(reportCard, org) {
  const pdfBuffer = await generateReportCardPDF(reportCard, org);

  const studentName = (
    reportCard.studentId?.fullname ||
    reportCard.studentId?.name ||
    "student"
  ).replace(/[^a-zA-Z0-9]/g, "_");

  const termName = (reportCard.termId?.name || "term").replace(/[^a-zA-Z0-9]/g, "_");
  const fileName = `report-cards/${studentName}_${termName}_${Date.now()}.pdf`;

  const { path: storagePath, publicUrl } = await storageService.upload(
    pdfBuffer,
    fileName,
    "application/pdf",
    reportCard.orgId?.toString() || reportCard.orgId,
    null,
  );

  Logger.info("Report card PDF uploaded", {
    studentId: reportCard.studentId?._id || reportCard.studentId,
    storagePath,
  });

  return { storageKey: storagePath, publicUrl };
}

module.exports = {
  generateReportCardPDF,
  generateAndUpload,
};
