/**
 * B2B Org Onboarding Routes
 *
 * POST /api/onboarding/org/register       - Create org + owner user, send welcome email
 * GET  /api/onboarding/org/check-slug     - Real-time slug availability check
 * POST /api/onboarding/org/verify-domain  - DNS TXT record check for email domain ownership
 * POST /api/onboarding/org/provision-email - Mark emailProvisioned = true on confirmed domain
 * POST /api/onboarding/org/setup-complete - Validate wizard completion, set org live
 *
 * Security: All state-changing routes require authenticateToken + CSRF (handled globally).
 * check-slug is public/unauthenticated (GET, CSRF-exempt).
 */

"use strict";
const router = require("express").Router();
const dns = require("dns").promises;
const crypto = require("crypto");
const mongoose = require("mongoose");

const Organization = require("../models/Organization");
const AcademicYear = require("../models/AcademicYear");
const Term = require("../models/Term");
const Classroom = require("../models/Classroom");
const Subject = require("../models/Subject");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const emailService = require("../services/emailService");
const Logger = require("../logger");
const { isValidEmail } = require("../middleware/sanitizer");
const { authenticateToken } = require("../middleware/auth");
const { requireOwner } = require("../middleware/orgAuth");
const { validateOrgRegister } = require("../middleware/inputValidator");

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function sendError(res, status, message, code = "VALIDATION_ERROR") {
  return res.status(status).json({ success: false, error: { code, message } });
}

function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, ...data });
}

const SCHOOL_TYPES = ["primary", "secondary", "combined", "tertiary", "other"];

// ── GET /api/onboarding/org/check-slug ───────────────────────────────────────
// Public endpoint — no auth required. Frontend calls on every keystroke.

router.get("/check-slug", async (req, res) => {
  try {
    const raw = (req.query.slug || "").toString().trim();
    if (!raw) {
      return sendError(res, 400, "slug query param is required");
    }

    const slug = slugify(raw);

    if (slug.length < 3) {
      return sendSuccess(res, { available: false, slug, reason: "too_short" });
    }

    // Reserved subdomains
    const RESERVED = [
      "www",
      "app",
      "api",
      "admin",
      "mail",
      "smtp",
      "ftp",
      "cdn",
      "static",
      "vayrex",
      "support",
      "help",
      "docs",
      "blog",
      "status",
    ];
    if (RESERVED.includes(slug)) {
      return sendSuccess(res, { available: false, slug, reason: "reserved" });
    }

    const exists = await Organization.findOne({ slug }).lean().select("_id");
    return sendSuccess(res, { available: !exists, slug });
  } catch (err) {
    Logger.error("check-slug error", { error: err.message });
    return sendError(res, 500, "Internal server error", "INTERNAL_ERROR");
  }
});

// ── POST /api/onboarding/org/register ────────────────────────────────────────
// Creates the org document + owner User doc. Sends welcome email.
// Caller: unauthenticated public signup form (OrgSignup.jsx)
// No authenticateToken — the owner account is created here.
// validateOrgRegister runs first and rejects any malformed input before
// the transaction even opens.

router.post("/register", validateOrgRegister, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      orgName,
      contactName,
      contactEmail,
      contactPassword,
      schoolType,
      estimatedEnrollment,
    } = req.body;

    // estimatedEnrollment already passed validateOrgRegister — safe to parse directly
    const enrollment = parseInt(estimatedEnrollment, 10) || 100;
    const normalizedEmail = contactEmail.toLowerCase().trim();

    // ── Check for duplicate owner email ──
    const existingUser = await User.findOne({ email: normalizedEmail })
      .lean()
      .select("_id")
      .session(session);
    if (existingUser) {
      await session.abortTransaction();
      return sendError(
        res,
        409,
        "An account with this email already exists",
        "EMAIL_CONFLICT",
      );
    }

    // ── Derive slug + subdomain ──
    let slug = slugify(orgName.trim());
    if (slug.length < 3) slug = slug.padEnd(3, "x");

    // Ensure slug uniqueness — append counter if needed
    let slugCandidate = slug;
    let counter = 1;
    while (
      await Organization.findOne({ slug: slugCandidate }).lean().select("_id").session(session)
    ) {
      slugCandidate = `${slug}-${counter++}`;
    }
    slug = slugCandidate;

    const subdomain = `${slug}.madebyovo.me`;
    const capacity = Organization.calcCapacity(enrollment);

    // ── Create org ──
    const [org] = await Organization.create(
      [
        {
          name: orgName.trim(),
          slug,
          subdomain,
          schoolType: schoolType || "secondary",
          plan: "school_starter",
          enrollmentCapacity: capacity,
          enrollmentCount: 0,
          setupStep: 1,
          setupComplete: false,
          isActive: false,
          billingContactEmail: normalizedEmail,
        },
      ],
      { session },
    );

    // ── Create owner user ──
    const owner = new User({
      username: contactName.trim(),
      fullname: contactName.trim(),
      email: normalizedEmail,
      password: contactPassword, // User model pre-save hook hashes this
      role: "user",
      organizationId: org._id,
      orgRole: "owner",
      seatAssignedAt: new Date(),
      emailVerified: false,
    });

    // Generate email verification token (re-use existing mechanism if present)
    if (typeof owner.generateVerificationToken === "function") {
      owner.generateVerificationToken();
    }

    await owner.save({ session });

    // Backfill billingContactId now that owner has an _id
    org.billingContactId = owner._id;
    await org.save({ session });

    await session.commitTransaction();

    // ── Post-commit side-effects (non-fatal) ──
    const setupUrl = `${process.env.FRONTEND_URL}/org-setup?orgId=${org._id}`;
    emailService
      .sendOrgWelcomeEmail(normalizedEmail, contactName.trim(), orgName.trim(), setupUrl)
      .catch((emailErr) => {
        Logger.error("sendOrgWelcomeEmail failed (non-fatal)", {
          error: emailErr.message,
          orgId: org._id,
        });
      });

    AuditLog.create({
      userId: owner._id,
      action: "org_created",
      orgId: org._id,
      details: { orgName: org.name, slug: org.slug, plan: org.plan },
      ip: req.ip,
    }).catch(() => {});

    Logger.info("Org registered", {
      orgId: org._id,
      slug: org.slug,
      ownerEmail: normalizedEmail,
    });

    return sendSuccess(
      res,
      {
        orgId: org._id,
        slug: org.slug,
        subdomain: org.subdomain,
        setupStep: org.setupStep,
        message: "Organisation registered. Check your email to continue setup.",
      },
      201,
    );
  } catch (err) {
    await session.abortTransaction().catch(() => {});
    Logger.error("org/register error", { error: err.message, stack: err.stack });
    if (err.code === 11000) {
      return sendError(
        res,
        409,
        "An organisation with this name already exists",
        "DUPLICATE_ORG",
      );
    }
    return sendError(res, 500, "Registration failed. Please try again.", "INTERNAL_ERROR");
  } finally {
    session.endSession();
  }
});

// All routes below this point require the caller to be authenticated as the org owner.

router.use(authenticateToken);

// ── POST /api/onboarding/org/verify-domain ────────────────────────────────────
// Checks DNS TXT record `vayrex-verify=<orgId>` on the supplied email domain.
// Frontend prompts the user to add this TXT record in their DNS provider.

router.post("/verify-domain", requireOwner, async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain || typeof domain !== "string") {
      return sendError(res, 400, "domain is required");
    }

    const cleanDomain = domain
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .toLowerCase()
      .trim();

    // Basic domain format sanity check
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z]{2,})+$/.test(cleanDomain)) {
      return sendError(res, 400, "Invalid domain format");
    }

    const org = await Organization.findOne({
      _id: req.user.organizationId,
    }).select("_id name emailDomain emailProvisioned");

    if (!org) {
      return sendError(res, 404, "Organisation not found", "ORG_NOT_FOUND");
    }

    const expectedRecord = `vayrex-verify=${org._id.toString()}`;

    let txtRecords;
    try {
      txtRecords = await dns.resolveTxt(cleanDomain);
    } catch (dnsErr) {
      Logger.warn("DNS lookup failed", { domain: cleanDomain, error: dnsErr.message });
      return sendSuccess(res, {
        verified: false,
        domain: cleanDomain,
        expectedRecord,
        reason: "dns_lookup_failed",
      });
    }

    // txtRecords is an array of arrays
    const flat = txtRecords.flat();
    const verified = flat.some((record) => record === expectedRecord);

    if (!verified) {
      return sendSuccess(res, {
        verified: false,
        domain: cleanDomain,
        expectedRecord,
        reason: "record_not_found",
      });
    }

    // Update org — store the verified domain but don't set emailProvisioned yet
    // (that happens in the next step: /provision-email)
    org.emailDomain = cleanDomain;
    await org.save();

    Logger.info("Domain verified", { orgId: org._id, domain: cleanDomain });
    return sendSuccess(res, { verified: true, domain: cleanDomain });
  } catch (err) {
    Logger.error("verify-domain error", { error: err.message });
    return sendError(res, 500, "Domain verification failed", "INTERNAL_ERROR");
  }
});

// ── POST /api/onboarding/org/provision-email ─────────────────────────────────
// Called after DNS verification succeeds. Marks emailProvisioned = true.

router.post("/provision-email", requireOwner, async (req, res) => {
  try {
    const org = await Organization.findOne({
      _id: req.user.organizationId,
    }).select("_id emailDomain emailProvisioned setupStep");

    if (!org) {
      return sendError(res, 404, "Organisation not found", "ORG_NOT_FOUND");
    }

    if (!org.emailDomain) {
      return sendError(
        res,
        400,
        "Verify your email domain first before provisioning",
        "DOMAIN_NOT_VERIFIED",
      );
    }

    org.emailProvisioned = true;
    if (org.setupStep < 2) org.setupStep = 2;
    await org.save();

    Logger.info("Email provisioned", { orgId: org._id, domain: org.emailDomain });
    return sendSuccess(res, {
      emailProvisioned: true,
      emailDomain: org.emailDomain,
      setupStep: org.setupStep,
    });
  } catch (err) {
    Logger.error("provision-email error", { error: err.message });
    return sendError(res, 500, "Provisioning failed", "INTERNAL_ERROR");
  }
});

// ── POST /api/onboarding/org/setup-complete ───────────────────────────────────
// Final wizard step. Validates the org has:
//   - At least 1 active AcademicYear
//   - At least 1 Classroom
//   - At least 1 Subject
// Then sets setupComplete = true, isActive = true, setupStep = 5.

router.post("/setup-complete", requireOwner, async (req, res) => {
  try {
    const orgId = req.user.organizationId;

    const [org, yearCount, classCount, subjectCount] = await Promise.all([
      Organization.findById(orgId).select("_id name setupComplete isActive setupStep"),
      AcademicYear.countDocuments({ orgId, isActive: true }),
      Classroom.countDocuments({ orgId }),
      Subject.countDocuments({ orgId, isActive: true }),
    ]);

    if (!org) {
      return sendError(res, 404, "Organisation not found", "ORG_NOT_FOUND");
    }

    if (org.setupComplete) {
      return sendSuccess(res, {
        setupComplete: true,
        message: "Setup was already completed.",
        subdomain: org.subdomain,
      });
    }

    const missing = [];
    if (yearCount === 0) missing.push("an active academic year");
    if (classCount === 0) missing.push("at least one classroom");
    if (subjectCount === 0) missing.push("at least one subject");

    if (missing.length > 0) {
      return sendError(
        res,
        422,
        `Setup is incomplete. Please add: ${missing.join(", ")}.`,
        "SETUP_INCOMPLETE",
      );
    }

    org.setupComplete = true;
    org.isActive = true;
    org.setupStep = 5;
    await org.save();

    AuditLog.create({
      userId: req.user.id,
      action: "org_updated",
      orgId,
      details: { event: "setup_complete" },
      ip: req.ip,
    }).catch(() => {});

    Logger.info("Org setup completed", { orgId, name: org.name });

    return sendSuccess(res, {
      setupComplete: true,
      isActive: true,
      subdomain: org.subdomain,
      message: `${org.name} is now live! Your portal is at https://${org.subdomain}`,
    });
  } catch (err) {
    Logger.error("setup-complete error", { error: err.message });
    return sendError(res, 500, "Failed to complete setup", "INTERNAL_ERROR");
  }
});

module.exports = router;
