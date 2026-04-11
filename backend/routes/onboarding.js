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
const { provisionSchoolSubdomain } = require("../services/provisioningService");
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
      Logger.info("[ONBOARDING] check-slug → reserved", { raw, slug });
      return sendSuccess(res, { available: false, slug, reason: "reserved" });
    }

    const exists = await Organization.findOne({ slug }).lean().select("_id");
    Logger.info("[ONBOARDING] check-slug", { raw, slug, available: !exists });
    return sendSuccess(res, { available: !exists, slug });
  } catch (err) {
    Logger.error("[ONBOARDING] check-slug error", { error: err.message });
    return sendError(res, 500, "Internal server error", "INTERNAL_ERROR");
  }
});

// ── POST /api/onboarding/org/register ────────────────────────────────────────
// Creates the org document + owner User doc. Sends welcome email.

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

    const enrollment = parseInt(estimatedEnrollment, 10) || 100;
    const normalizedEmail = contactEmail.toLowerCase().trim();

    Logger.info("[ONBOARDING] register → started", {
      orgName,
      contactName,
      contactEmail: normalizedEmail,
      schoolType,
      estimatedEnrollment: enrollment,
      ip: req.ip,
    });

    // ── Check for duplicate owner email ──
    const existingUser = await User.findOne({ email: normalizedEmail })
      .lean()
      .select("_id")
      .session(session);
    if (existingUser) {
      await session.abortTransaction();
      Logger.warn("[ONBOARDING] register → email already exists", { email: normalizedEmail });
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

    let slugCandidate = slug;
    let counter = 1;
    while (
      await Organization.findOne({ slug: slugCandidate }).lean().select("_id").session(session)
    ) {
      slugCandidate = `${slug}-${counter++}`;
    }
    slug = slugCandidate;
    const subdomain = `${slug}.madebyovo.me`;

    Logger.info("[ONBOARDING] register → slug resolved", { orgName, slug, subdomain });

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

    Logger.info("[ONBOARDING] register → org document created", {
      orgId: org._id,
      slug: org.slug,
      subdomain: org.subdomain,
      plan: org.plan,
    });

    // ── Create owner user ──
    const owner = new User({
      username: contactName.trim(),
      fullname: contactName.trim(),
      email: normalizedEmail,
      password: contactPassword,
      role: "user",
      organizationId: org._id,
      orgRole: "owner",
      seatAssignedAt: new Date(),
      emailVerified: false,
    });

    if (typeof owner.generateVerificationToken === "function") {
      owner.generateVerificationToken();
    }

    await owner.save({ session });

    org.billingContactId = owner._id;
    await org.save({ session });

    await session.commitTransaction();

    Logger.info("[ONBOARDING] register → transaction committed", {
      orgId: org._id,
      ownerId: owner._id,
      ownerEmail: normalizedEmail,
    });

    // ── Post-commit side-effects ──
    const setupUrl = `${process.env.FRONTEND_URL}/org-setup?orgId=${org._id}`;

    Logger.info("[ONBOARDING] register → sending welcome email", {
      to: normalizedEmail,
      setupUrl,
    });

    emailService
      .sendOrgWelcomeEmail(normalizedEmail, contactName.trim(), orgName.trim(), setupUrl)
      .then(() => {
        Logger.info("[ONBOARDING] register → welcome email sent", { to: normalizedEmail });
      })
      .catch((emailErr) => {
        Logger.error("[ONBOARDING] register → welcome email FAILED (non-fatal)", {
          error: emailErr.message,
          orgId: org._id,
          to: normalizedEmail,
        });
      });

    AuditLog.create({
      userId: owner._id,
      action: "org_created",
      orgId: org._id,
      details: { orgName: org.name, slug: org.slug, plan: org.plan },
      ip: req.ip,
    }).catch(() => {});

    Logger.info("[ONBOARDING] register → complete", {
      orgId: org._id,
      slug: org.slug,
      subdomain: org.subdomain,
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
    Logger.error("[ONBOARDING] register → ERROR", { error: err.message, stack: err.stack });
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

// All routes below require the caller to be authenticated as the org owner.

router.use(authenticateToken);

// ── POST /api/onboarding/org/verify-domain ────────────────────────────────────

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

    Logger.info("[ONBOARDING] verify-domain → started", {
      orgId: req.user.organizationId,
      rawDomain: domain,
      cleanDomain,
    });

    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z]{2,})+$/.test(cleanDomain)) {
      Logger.warn("[ONBOARDING] verify-domain → invalid format", { cleanDomain });
      return sendError(res, 400, "Invalid domain format");
    }

    const org = await Organization.findOne({ _id: req.user.organizationId }).select(
      "_id name emailDomain emailProvisioned",
    );

    if (!org) {
      return sendError(res, 404, "Organisation not found", "ORG_NOT_FOUND");
    }

    const expectedRecord = `vayrex-verify=${org._id.toString()}`;
    Logger.info("[ONBOARDING] verify-domain → looking up DNS TXT", {
      orgId: org._id,
      domain: cleanDomain,
      expectedRecord,
    });

    let txtRecords;
    try {
      txtRecords = await dns.resolveTxt(cleanDomain);
      Logger.info("[ONBOARDING] verify-domain → DNS TXT records found", {
        domain: cleanDomain,
        records: txtRecords.flat(),
      });
    } catch (dnsErr) {
      Logger.warn("[ONBOARDING] verify-domain → DNS lookup failed", {
        domain: cleanDomain,
        error: dnsErr.message,
      });
      return sendSuccess(res, {
        verified: false,
        domain: cleanDomain,
        expectedRecord,
        reason: "dns_lookup_failed",
      });
    }

    const flat = txtRecords.flat();
    const verified = flat.some((r) => r === expectedRecord);

    if (!verified) {
      Logger.warn("[ONBOARDING] verify-domain → TXT record NOT found", {
        orgId: org._id,
        domain: cleanDomain,
        expectedRecord,
        foundRecords: flat,
      });
      return sendSuccess(res, {
        verified: false,
        domain: cleanDomain,
        expectedRecord,
        reason: "record_not_found",
      });
    }

    org.emailDomain = cleanDomain;
    await org.save();

    Logger.info("[ONBOARDING] verify-domain → VERIFIED", {
      orgId: org._id,
      domain: cleanDomain,
    });
    return sendSuccess(res, { verified: true, domain: cleanDomain });
  } catch (err) {
    Logger.error("[ONBOARDING] verify-domain → ERROR", { error: err.message });
    return sendError(res, 500, "Domain verification failed", "INTERNAL_ERROR");
  }
});

// ── POST /api/onboarding/org/provision-email ─────────────────────────────────

router.post("/provision-email", requireOwner, async (req, res) => {
  try {
    Logger.info("[ONBOARDING] provision-email → started", { orgId: req.user.organizationId });

    const org = await Organization.findOne({ _id: req.user.organizationId }).select(
      "_id emailDomain emailProvisioned setupStep",
    );

    if (!org) {
      return sendError(res, 404, "Organisation not found", "ORG_NOT_FOUND");
    }

    if (!org.emailDomain) {
      Logger.warn("[ONBOARDING] provision-email → no verified domain on record", {
        orgId: org._id,
      });
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

    Logger.info("[ONBOARDING] provision-email → complete", {
      orgId: org._id,
      domain: org.emailDomain,
      setupStep: org.setupStep,
    });

    return sendSuccess(res, {
      emailProvisioned: true,
      emailDomain: org.emailDomain,
      setupStep: org.setupStep,
    });
  } catch (err) {
    Logger.error("[ONBOARDING] provision-email → ERROR", { error: err.message });
    return sendError(res, 500, "Provisioning failed", "INTERNAL_ERROR");
  }
});

// ── POST /api/onboarding/org/pre-provision ───────────────────────────────────
// Called right after the owner confirms their URL in Step 1.
// Kicks off Netlify + Cloudflare provisioning early so DNS can propagate
// while the owner completes the remaining setup steps.  Fire-and-forget —
// we respond immediately and don't block on provisioning results.

router.post("/pre-provision", requireOwner, async (req, res) => {
  try {
    const org = await Organization.findOne({ _id: req.user.organizationId }).select(
      "_id slug subdomain name setupComplete",
    );

    if (!org) return sendError(res, 404, "Organisation not found", "ORG_NOT_FOUND");

    // Skip if already live — no need to re-provision.
    if (org.setupComplete) {
      return sendSuccess(res, { triggered: false, reason: "already_live" });
    }

    Logger.info("[ONBOARDING] pre-provision → firing early provisioning", {
      orgId: org._id,
      slug: org.slug,
      subdomain: org.subdomain,
    });

    // Fire-and-forget — we do not await this.
    provisionSchoolSubdomain({ slug: org.slug, subdomain: org.subdomain })
      .then((results) => {
        Logger.info("[ONBOARDING] pre-provision → results", {
          orgId: org._id,
          netlify: results.netlify,
          dns: results.dns,
        });
      })
      .catch((err) => {
        Logger.warn(
          "[ONBOARDING] pre-provision → provisioning error (will retry at go-live)",
          {
            orgId: org._id,
            error: err.message,
          },
        );
      });

    return sendSuccess(res, { triggered: true });
  } catch (err) {
    Logger.error("[ONBOARDING] pre-provision → ERROR", { error: err.message });
    return sendError(res, 500, "Pre-provisioning failed", "INTERNAL_ERROR");
  }
});

// ── POST /api/onboarding/org/setup-complete ───────────────────────────────────

router.post("/setup-complete", requireOwner, async (req, res) => {
  try {
    const orgId = req.user.organizationId;

    Logger.info("[ONBOARDING] setup-complete → started", {
      orgId,
      ownerEmail: req.user.email,
    });

    const [org, activeYearCount, anyYearCount, classCount, subjectCount] = await Promise.all([
      Organization.findById(orgId).select(
        "_id name slug subdomain setupComplete isActive setupStep",
      ),
      AcademicYear.countDocuments({ orgId, isActive: true }),
      AcademicYear.countDocuments({ orgId }),
      Classroom.countDocuments({ orgId }),
      Subject.countDocuments({ orgId, isActive: true }),
    ]);

    Logger.info("[ONBOARDING] setup-complete → checklist", {
      orgId,
      orgName: org?.name,
      activeYears: activeYearCount,
      totalYears: anyYearCount,
      classrooms: classCount,
      subjects: subjectCount,
      alreadyComplete: org?.setupComplete,
    });

    if (!org) {
      return sendError(res, 404, "Organisation not found", "ORG_NOT_FOUND");
    }

    if (org.setupComplete) {
      Logger.info("[ONBOARDING] setup-complete → already completed, skipping", { orgId });
      return sendSuccess(res, {
        setupComplete: true,
        message: "Setup was already completed.",
        subdomain: org.subdomain,
      });
    }

    // If a year exists but none are active, auto-activate the most recent one
    if (activeYearCount === 0 && anyYearCount > 0) {
      Logger.info(
        "[ONBOARDING] setup-complete → no active year found, auto-activating latest",
        { orgId },
      );
      await AcademicYear.findOneAndUpdate(
        { orgId },
        { $set: { isActive: true } },
        { sort: { createdAt: -1 } },
      );
    }

    const missing = [];
    if (anyYearCount === 0) missing.push("an academic year");
    if (classCount === 0) missing.push("at least one classroom");
    if (subjectCount === 0) missing.push("at least one subject");

    if (missing.length > 0) {
      Logger.warn("[ONBOARDING] setup-complete → INCOMPLETE", { orgId, missing });
      return sendError(
        res,
        422,
        `Setup is incomplete. Please add: ${missing.join(", ")}.`,
        "SETUP_INCOMPLETE",
      );
    }

    org.setupComplete = true;
    org.isActive = true;
    org.setupStep = 6;
    await org.save();

    Logger.info("[ONBOARDING] setup-complete → org marked live", {
      orgId,
      name: org.name,
      subdomain: org.subdomain,
    });

    AuditLog.create({
      userId: req.user.id,
      action: "org_updated",
      orgId,
      details: { event: "setup_complete" },
      ip: req.ip,
    }).catch(() => {});

    // Auto-provision Netlify alias + Cloudflare DNS
    Logger.info("[ONBOARDING] setup-complete → triggering provisioning", {
      orgId,
      slug: org.slug,
      subdomain: org.subdomain,
    });

    provisionSchoolSubdomain({ slug: org.slug, subdomain: org.subdomain })
      .then((results) => {
        const netlifyOk = results.netlify?.added || results.netlify?.alreadyExists;
        const dnsOk = results.dns?.created || results.dns?.alreadyExists;
        const dnsSkipped = results.dns?.skipped;

        Logger.info("[ONBOARDING] setup-complete → provisioning results", {
          orgId,
          slug: org.slug,
          netlify: results.netlify,
          dns: results.dns,
          netlifyOk,
          dnsOk,
          dnsSkipped,
        });

        if (!netlifyOk || !dnsOk) {
          Logger.warn(
            "[ONBOARDING] setup-complete → provisioning partial/failed — sending fallback email",
            {
              orgId,
              netlifyFailed: !!results.netlify?.error,
              dnsFailed: !!results.dns?.error,
              dnsSkipped,
            },
          );
          emailService.sendDnsProvisioningAlert({
            orgId: orgId.toString(),
            orgName: org.name,
            slug: org.slug,
            subdomain: org.subdomain,
            ownerEmail: req.user.email,
            ownerName: req.user.name || req.user.email,
          });
        } else {
          Logger.info(
            "[ONBOARDING] setup-complete → provisioning fully automated, no manual action needed",
            {
              orgId,
              subdomain: org.subdomain,
            },
          );
        }
      })
      .catch((err) => {
        Logger.error(
          "[ONBOARDING] setup-complete → provisioning CRASHED, sending fallback email",
          {
            orgId,
            error: err.message,
          },
        );
        emailService.sendDnsProvisioningAlert({
          orgId: orgId.toString(),
          orgName: org.name,
          slug: org.slug,
          subdomain: org.subdomain,
          ownerEmail: req.user.email,
          ownerName: req.user.name || req.user.email,
        });
      });

    Logger.info("[ONBOARDING] setup-complete → response sent to client", {
      orgId,
      subdomain: org.subdomain,
    });

    return sendSuccess(res, {
      setupComplete: true,
      isActive: true,
      subdomain: org.subdomain,
      message: `${org.name} is now live! Your portal is at https://${org.subdomain}`,
    });
  } catch (err) {
    Logger.error("[ONBOARDING] setup-complete → ERROR", {
      error: err.message,
      stack: err.stack,
    });
    return sendError(res, 500, "Failed to complete setup", "INTERNAL_ERROR");
  }
});

module.exports = router;
