require("dotenv").config();
const { validateEnvironment } = require("./config/env");
validateEnvironment();

// Helper function to escape regex special characters
const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Server configuration and imports
const express = require("express");
const Validators = require("./validators");
const fileUpload = require("express-fileupload");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
// B2B: AWS SDK S3 imports removed — using Supabase via storageService
// Legacy references kept as comments for migration traceability
const mime = require("mime-types");
const { createOpenAIClient } = require("./openaiClient");
const aiService = require("./services/aiService");
const batchGenerationService = require("./services/batchGenerationService");
const pdfExportService = require("./services/pdfExportService");
const {
  taskQueue,
  getUserActiveJobs,
  incrementUserActiveJobs,
} = require("./services/taskQueue");
require("./workers/quizWorker");
require("./scheduler"); // Start all cron jobs (daily reset, monthly reset, health checks, etc.)
// B2B: S3 presigner removed — signed URLs handled by storageService
const Logger = require("./logger");
const ErrorCodes = require("./errorCodes");
const errorHandler = require("./middleware/errorHandler");
const { requestValidator } = require("./middleware/requestValidator");
// CSRF: Using custom stateless HMAC-signed tokens (no cookies needed)
// This works across all devices/browsers regardless of third-party cookie policies
const cookieParser = require("cookie-parser");
const sharp = require("sharp");
const { validateFileUpload, validateMultiFileUpload } = require("./middleware/fileValidator");
const { validateContact } = require("./middleware/inputValidator");
const {
  computeCombinedContentHash,
  createBundle,
  buildBundleS3Key,
} = require("./services/multiFileService");

// Import all parsers from centralized module
const {
  parsePdf,
  parseDocx,
  parsePptx,
  parseQuestionsFromText,
  normalizeText,
  cleanExtractedText,
  preprocessMergedQuestions,
  sanitizeText,
} = require("./parsers");

const publicRoutes = require("./routes/public");
const adminRoutes = require("./routes/admin");
const authRoutes = require("./routes/auth");
const onboardingRoutes = require("./routes/onboarding");
const orgRoutes = require("./routes/org");
const gradebookRoutes = require("./routes/gradebook");
const reportCardRoutes = require("./routes/reportCards");
const assignmentRoutes = require("./routes/assignments");
const attendanceRoutes = require("./routes/attendance");
const announcementRoutes = require("./routes/announcements");
const guardianRoutes = require("./routes/guardian");

// B2B: pre-load org models so Mongoose registers them before any route uses them
require("./models/Organization");
require("./models/AcademicYear");
require("./models/Term");
require("./models/Classroom");
require("./models/Subject");
require("./models/SubjectAssignment");
require("./models/Invitation");

const { rateLimiter, createEndpointLimiter } = require("./middleware/rateLimiter");
const {
  advancedAttackLimiter,
  notFoundAttackTracker,
  recordAuthFailure,
} = require("./middleware/advancedRateLimiter");
const { responseHardening } = require("./middleware/responseHardening");
const {
  sanitizeRequestBody,
  sanitizeQueryParams,
  isValidEmail,
  validateFileName,
  sanitizeUrlParams,
} = require("./middleware/sanitizer");

const { PasswordValidator, AccountLockout } = require("./security/passwordValidator");
const { initializeRedis, getRedisClient, disconnectRedis } = require("./redisClient");

const {
  connectDatabase,
  setupEventHandlers,
  getStatus,
  disconnect,
} = require("./config/database");
const { checkDatabaseHealth } = require("./middleware/healthCheck");

// Import middleware and utilities
const {
  authenticateToken,
  identifyUser,
  requireAdmin,
  checkUploadLimit,
  checkFileSize,
  checkStorageLimit,
  trackUpload,
  trackTokenUsage,
  checkTokenLimit,
} = require("./middleware/auth");

const { denyITAdminAcademic } = require("./middleware/orgAuth");

const Result = require("./models/result");
const Question = require("./models/questions");
const PdfLibrary = require("./models/PdfLibrary");
const User = require("./models/User");
const Contact = require("./models/contact");
const SummarySession = require("./models/SummarySession");
const ChatThread = require("./models/ChatThread");
const { response } = require("express");
const { error } = require("console");

const app = express();

// Trust first proxy (e.g., NGINX) so secure cookies and IPs work correctly
app.set("trust proxy", 1);

// ===== GZIP COMPRESSION =====
const compression = require("compression");
app.use(
  compression({
    level: 6,
    threshold: 1024, // Only compress responses > 1KB
    filter: (req, res) => {
      // Don't compress if client doesn't accept it
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  }),
);

// ===== GLOBAL REQUEST TIMEOUT =====
app.use((req, res, next) => {
  // 2-minute default, 5 min for uploads/bulk, 3 min for AI/export
  let timeout = 120000;
  if (req.path.includes("/upload/bulk")) timeout = 300000;
  else if (req.path.includes("/upload") || req.path.includes("/ai/")) timeout = 180000;
  else if (req.path.includes("/export/pdf")) timeout = 180000;

  req.setTimeout(timeout);
  res.setTimeout(timeout, () => {
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        error: { code: "REQUEST_TIMEOUT", message: "Request timed out. Please try again." },
      });
    }
  });
  next();
});

// ===== ENHANCED HELMET SECURITY =====
const helmet = require("helmet");

app.use(
  helmet({
    // Content Security Policy - STRICT
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          ...(process.env.NODE_ENV !== "production" ? ["'unsafe-eval'"] : []),
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: [
          "'self'",
          ...(process.env.NODE_ENV !== "production" ? ["http://localhost:*"] : []),
        ],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
      },
    },

    // DNS Prefetch Control - prevent leaking via DNS
    dnsPrefetchControl: { allow: false },

    // Expect-CT - Certificate Transparency
    expectCt: {
      maxAge: 86400,
      enforce: true,
    },

    // Frameguard - prevent clickjacking
    frameguard: { action: "deny" },

    // Hide Powered By header
    hidePoweredBy: true,

    // HSTS - force HTTPS (production only)
    hsts:
      process.env.NODE_ENV === "production"
        ? {
            maxAge: 31536000, // 1 year
            includeSubDomains: true,
            preload: true,
          }
        : false,

    // IE No Open - prevents IE from executing downloads
    ieNoOpen: true,

    // No Sniff - prevent MIME sniffing
    noSniff: true,

    // Origin Agent Cluster - isolate origins
    originAgentCluster: true,

    // Permitted Cross Domain Policies
    permittedCrossDomainPolicies: { permittedPolicies: "none" },

    // Referrer Policy - control referrer information
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },

    // XSS Filter - legacy but still useful
    xssFilter: true,
  }),
);

// Additional security headers not in helmet
app.use((req, res, next) => {
  // Feature Policy / Permissions Policy - disable dangerous features
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), " +
      "magnetometer=(), gyroscope=(), speaker=(), vibrate=(), " +
      "fullscreen=(self), sync-xhr=()",
  );

  // Expect-CT for Certificate Transparency
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Expect-CT", "enforce, max-age=86400");
  }

  // X-Download-Options - prevent IE MIME sniffing downloads
  res.setHeader("X-Download-Options", "noopen");

  // X-Permitted-Cross-Domain-Policies - no cross-domain access
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");

  next();
});

// ===== XSS PROTECTION MIDDLEWARE - CRITICAL FOR TAB ISOLATION =====
// Must come before any route handlers
const { xssProtection } = require("./middleware/xssProtection");
app.use(xssProtection);

// ===== 12-LAYER ADVERSARIAL RATE LIMITER (attacks only, not users) =====
// DISABLED: Causing CORS issues on localhost — re-enable in production
// app.use(advancedAttackLimiter);

// ===== RESPONSE HARDENING (minimize HAR/Network Tab leakage) =====
// Strips Server header, removes ETag on API routes, normalizes auth timing,
// maps all error codes to 12 canonical codes in production
app.use(responseHardening());

app.use((req, res, next) => {
  const trustedProxies = (process.env.TRUSTED_PROXIES || "").split(",").filter(Boolean);
  if (trustedProxies.length === 0) {
    // No trusted proxies configured — strip all IP-spoofing headers
    delete req.headers["client-ip"];
    delete req.headers["true-client-ip"];
    delete req.headers["cf-connecting-ip"];
    // X-Forwarded-For and X-Real-IP are handled by L9 in advancedRateLimiter
  }
  next();
});

// ===== BODY PARAMETER POLLUTION GUARD (DOOMSDAY DEFENSE) =====
// Blocks attacker-injected fields like role, isAdmin, userId in request bodies
// delete-exploit.ts injects {id: targetId, userId: targetId} in DELETE body
// escalate-admin.ts sends {newRole: "admin"} in PATCH body
const BANNED_BODY_FIELDS = [
  "role",
  "isAdmin",
  "isSuperAdmin",
  "subscriptionTier",
  "subscriptionStatus",
  "tokenVersion",
  "emailVerified",
  "isActive",
  "__proto__",
  "constructor",
  "prototype",
  // B2B: users must never self-assign org membership or escalate org role
  "organizationId",
  "orgId",
  "orgRole",
  "seatAssignedAt",
  "guardianOf",
];
app.use((req, res, next) => {
  if (!req.body || typeof req.body !== "object") return next();
  const path = (req.path || "").toLowerCase();
  // Only allow role/admin fields on actual admin routes
  if (path.startsWith("/api/admin/")) return next();
  for (const field of BANNED_BODY_FIELDS) {
    if (req.body[field] !== undefined) {
      Logger.warn("Body parameter pollution blocked", {
        ip: req.ip,
        path: req.path,
        field,
      });
      delete req.body[field];
    }
  }
  // Block body params that try to override userId/id (IDOR via pollution)
  if (req.method === "DELETE" || req.method === "PUT" || req.method === "PATCH") {
    if (req.body.userId && req.user && req.body.userId !== req.user.id) {
      Logger.warn("IDOR body pollution attempt blocked", { ip: req.ip, path: req.path });
      delete req.body.userId;
    }
    if (req.body.id && req.user && req.body.id !== req.user.id) {
      delete req.body.id;
    }
  }
  next();
});

// ===== REFRESH TOKEN RATE LIMIT (DOOMSDAY DEFENSE) =====
// ghost-session.ts does infinite token rotation via heartbeat
// Limit refresh endpoint to 10 refreshes per hour per IP
const refreshLimiter = createEndpointLimiter(
  10,
  60 * 60 * 1000,
  "Too many token refresh attempts",
);
app.use("/api/auth/refresh", refreshLimiter);

// Helper to safely return user without password
function sanitizeUser(user) {
  const userObj = user.toObject ? user.toObject() : user;
  delete userObj.password;
  return userObj;
}

function sendError(res, statusCode, message, errorCode = "INTERNAL_ERROR") {
  return res.status(statusCode).json({
    success: false,
    message,
    error: errorCode,
  });
}

function sendSuccess(res, data = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    ...data,
  });
}

const ResponseFormatter = {
  success: (data, statusCode = 200) => ({
    success: true,
    data,
    error: null,
    timestamp: new Date().toISOString(),
  }),

  successPaginated: (data, pagination = {}, statusCode = 200) => ({
    success: true,
    data,
    pagination: {
      currentPage: pagination.currentPage || 1,
      totalPages: pagination.totalPages || 1,
      totalResults: pagination.totalResults || data.length,
      resultsPerPage: pagination.resultsPerPage || data.length,
    },
    error: null,
    timestamp: new Date().toISOString(),
  }),

  error: (message, errorCode = "INTERNAL_ERROR", statusCode = 500) => ({
    success: false,
    data: null,
    error: {
      message,
      code: errorCode,
      timestamp: new Date().toISOString(),
    },
  }),

  // Message-only success (for create/update/delete)
  message: (message, statusCode = 200) => ({
    success: true,
    data: { message },
    error: null,
    timestamp: new Date().toISOString(),
  }),
};

function ensureObjectId(userId) {
  if (!userId) return null;

  if (typeof userId === "string") {
    try {
      return new mongoose.Types.ObjectId(userId);
    } catch (err) {
      Logger.warn("Invalid user ID format", { userId });
      return null;
    }
  }
  return userId;
}

// ===== CORS =====
const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS ||
  "http://localhost:5173,http://localhost:5174,https://vayrex.netlify.app"
)
  .split(",")
  .map((s) => s.trim());
Logger.info("CORS Configuration", {
  allowedOrigins: ALLOWED_ORIGINS,
  nodeEnv: process.env.NODE_ENV,
});

app.use(
  cors({
    origin: (origin, callback) => {
      Logger.debug("CORS Origin Check", { origin, allowedOrigins: ALLOWED_ORIGINS });

      // Allow same-origin requests (no Origin header) - return true for server-to-server
      if (!origin) {
        return callback(null, true);
      }

      // Check whitelisted origins - return the specific origin
      if (ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, origin);
      }

      // Allow all madebyovo.me subdomains and root domain
      if (origin === "https://madebyovo.me" || origin.endsWith(".madebyovo.me")) {
        return callback(null, origin);
      }

      // Check for tunnel URLs in development only
      if (process.env.NODE_ENV !== "production") {
        if (
          origin.includes(".ngrok-free.dev") ||
          origin.includes(".ngrok-free.app") ||
          origin.includes(".ngrok.io") ||
          origin.includes(".loca.lt") ||
          origin.includes(".netlify.app")
        ) {
          return callback(null, origin);
        }
      }

      // In production, only allow specific netlify app domain
      if (process.env.NODE_ENV === "production" && process.env.PRODUCTION_FRONTEND_URL) {
        if (origin === process.env.PRODUCTION_FRONTEND_URL) {
          return callback(null, origin);
        }
      }

      Logger.warn("CORS Blocked", { origin, allowedOrigins: ALLOWED_ORIGINS });
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-CSRF-Token",
      "X-Requested-With",
      "Bypass-Tunnel-Reminder",
      "ngrok-skip-browser-warning",
    ],
    exposedHeaders: ["X-CSRF-Token"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400, // Cache preflight requests for 24 hours
  }),
);

app.use((req, res, next) => {
  // 1mb body size cap — prevents memory exhaustion from oversized JSON payloads (DDoS)
  express.json({ limit: "1mb" })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

// Registration of global utilities that don't depend on routes
app.use(
  fileUpload({
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 10, // SECURITY: Hard cap matches ABSOLUTE_MAX_FILES (was 25 — buffered excess into RAM)
    },
    abortOnLimit: true,
    useTempFiles: false,
    safeFileNames: true,
    preserveExtension: 4,
  }),
);

app.use(sanitizeQueryParams);
app.use(sanitizeUrlParams);

// ===== QUERY PARAMETER HARDENING (DOOMSDAY DEFENSE) =====
// Caps limit/page params, blocks wildcard *, rejects negative pagination
// Catches ?limit=99999999&department=* before it reaches any route handler
const QUERY_MAX_LIMIT = Number(process.env.QUERY_MAX_LIMIT) || 500;
app.use((req, res, next) => {
  if (!req.query || typeof req.query !== "object") return next();

  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value !== "string") continue;

    // Block wildcard * in any query param value
    if (value === "*" || value.includes("*")) {
      Logger.warn("Wildcard query param blocked", { ip: req.ip, path: req.path, key, value });
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_REQUEST", message: "Invalid query parameter" },
      });
    }

    // Cap limit/pageSize/per_page/count to QUERY_MAX_LIMIT
    if (["limit", "pagesize", "per_page", "count"].includes(key.toLowerCase())) {
      const num = parseInt(value);
      if (!isNaN(num) && num > QUERY_MAX_LIMIT) {
        req.query[key] = String(QUERY_MAX_LIMIT); // Silently cap it
        Logger.warn("Excessive limit capped", {
          ip: req.ip,
          path: req.path,
          original: value,
          capped: QUERY_MAX_LIMIT,
        });
      }
      if (!isNaN(num) && num < 1) {
        req.query[key] = "1"; // Floor at 1
      }
    }

    // Block negative page/offset/skip
    if (["page", "offset", "skip"].includes(key.toLowerCase())) {
      const num = parseInt(value);
      if (!isNaN(num) && num < 0) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_REQUEST", message: "Invalid query parameter" },
        });
      }
    }
  }
  next();
});

//  SANITIZATION: Apply to ALL routes (no exemptions)
// Fields marked as VALIDATE_ONLY_FIELDS will be preserved but still validated
app.use(
  sanitizeRequestBody([
    "explanation",
    "questionText",
    "message",
    "correctAnswer",
    "options",
    "qnum",
    "questionType",
    "difficulty",
    "sourceFile",
    "topic",
    "text",
    "content",
    "answers",
    "extractedText",
  ]),
);

app.get("/api/ai/job-status/:jobId", authenticateToken, async (req, res) => {
  try {
    const jobId = decodeURIComponent(req.params.jobId || "");
    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_JOB_ID",
          message: "Job ID is required",
        },
      });
    }
    const job = await taskQueue.getJob(jobId);

    if (!job) {
      // Job may have been removed after completion; try to resolve via Questions
      const completedQuestionsCount = await Question.countDocuments({
        batchId: `job-${jobId}`,
        userId: req.user.id,
      });
      if (completedQuestionsCount > 0) {
        const firstQuestion = await Question.findOne({
          batchId: `job-${jobId}`,
          userId: req.user.id,
        })
          .select("topic")
          .lean();
        return res.json({
          success: true,
          jobId,
          status: "completed",
          progress: 100,
          partialQuestions: [],
          result: {
            questionsCount: completedQuestionsCount,
            topic: firstQuestion.topic,
          },
          failedReason: null,
        });
      }

      return res.status(404).json({
        success: false,
        error: {
          code: "JOB_NOT_FOUND",
          message: "Processing job not found",
        },
      });
    }

    // Verify ownership (IDOR FIX: normalize both sides to string)
    if (String(job.data.userId) !== String(req.user.id)) {
      return res
        .status(403)
        .json({ success: false, error: { code: "FORBIDDEN", message: "Forbidden" } });
    }

    const state = await job.getState();
    const progressData =
      typeof job.progress === "object" && job.progress !== null
        ? job.progress
        : { percent: job.progress || 0 };
    const result = job.returnvalue;
    const failedReason = job.failedReason;

    res.json({
      success: true,
      jobId,
      status: state, // 'active', 'completed', 'failed', 'waiting', 'delayed'
      progress: progressData.percent,
      partialQuestions: progressData.partialQuestions || [],
      result,
      failedReason,
    });
  } catch (err) {
    Logger.error("Error fetching job status:", { error: err.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

const _sseActiveConnections = new Map();
const MAX_SSE_PER_USER = Number(process.env.MAX_SSE_PER_USER) || 10;

const _summaryJobStore = new Map();

function _summaryJobCreate(userId) {
  const jobId = crypto.randomUUID();
  _summaryJobStore.set(jobId, {
    userId,
    status: "processing",
    title: null,
    chapters: [],
    client: null,
    error: null,
  });
  setTimeout(() => _summaryJobStore.delete(jobId), 15 * 60 * 1000);
  return jobId;
}

function _summaryJobEmit(jobId, event) {
  const job = _summaryJobStore.get(jobId);
  if (!job) return;
  // Update in-memory state
  if (event.type === "title") {
    job.title = event.title;
  } else if (event.type === "chapter") {
    job.chapters.push(event.chapter);
  } else if (event.type === "complete") {
    job.status = "completed";
  } else if (event.type === "error") {
    job.status = "failed";
    job.error = event.message;
  }
  // Course outline events: chapter_overview and sub_chapter don't update in-memory chapters
  // (those are persisted directly to MongoDB by outlineGenerationService)
  // Forward to live client
  if (job.client) {
    job.client.write(JSON.stringify(event) + "\n");
    if (event.type === "complete" || event.type === "error") {
      job.client.end();
      job.client = null;
    }
  }
}

app.get("/api/ai/job-status/stream/:jobId", authenticateToken, async (req, res) => {
  const jobId = decodeURIComponent(req.params.jobId || "");
  if (!jobId) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_JOB_ID", message: "Job ID is required" },
    });
  }

  // Enforce per-user SSE connection limit (DDoS: socket/fd exhaustion)
  const sseUserId = req.user.id;
  const currentSseCount = _sseActiveConnections.get(sseUserId) || 0;
  if (currentSseCount >= MAX_SSE_PER_USER) {
    return res.status(429).json({
      success: false,
      error: {
        code: "TOO_MANY_STREAMS",
        message:
          "Too many active status streams. Close existing connections before opening new ones.",
        activeConnections: currentSseCount,
        max: MAX_SSE_PER_USER,
      },
    });
  }
  _sseActiveConnections.set(sseUserId, currentSseCount + 1);

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let closed = false;
  const intervalMs = Number(process.env.JOB_STATUS_STREAM_INTERVAL_MS) || 2000;

  const sendStatus = async () => {
    if (closed) return;
    try {
      const job = await taskQueue.getJob(jobId);

      if (!job) {
        const completedQuestionsCount = await Question.countDocuments({
          batchId: `job-${jobId}`,
          userId: req.user.id,
        });
        if (completedQuestionsCount > 0) {
          const firstQuestion = await Question.findOne({
            batchId: `job-${jobId}`,
            userId: req.user.id,
          })
            .select("topic")
            .lean();
          res.write(
            JSON.stringify({
              success: true,
              jobId,
              status: "completed",
              progress: 100,
              partialQuestions: [],
              result: {
                questionsCount: completedQuestionsCount,
                topic: firstQuestion.topic,
              },
              failedReason: null,
            }) + "\n",
          );
          res.end();
          closed = true;
          return;
        }

        res.write(
          JSON.stringify({
            success: false,
            error: { code: "JOB_NOT_FOUND", message: "Processing job not found" },
          }) + "\n",
        );
        res.end();
        closed = true;
        return;
      }

      if (String(job.data.userId) !== String(req.user.id)) {
        res.write(
          JSON.stringify({
            success: false,
            error: { code: "FORBIDDEN", message: "Forbidden" },
          }) + "\n",
        );
        res.end();
        closed = true;
        return;
      }

      const state = await job.getState();
      const progressData =
        typeof job.progress === "object" && job.progress !== null
          ? job.progress
          : { percent: job.progress || 0 };
      const result = job.returnvalue;
      const failedReason = job.failedReason;

      res.write(
        JSON.stringify({
          success: true,
          jobId,
          status: state,
          progress: progressData.percent,
          partialQuestions: progressData.partialQuestions || [],
          result,
          failedReason,
        }) + "\n",
      );

      if (state === "completed" || state === "failed") {
        res.end();
        closed = true;
      }
    } catch (err) {
      Logger.error("Error streaming job status:", { error: err.message });
      res.write(
        JSON.stringify({
          success: false,
          error: { code: "SERVER_ERROR", message: "Internal server error" },
        }) + "\n",
      );
      res.end();
      closed = true;
    }
  };

  const timer = setInterval(sendStatus, intervalMs);
  req.on("close", () => {
    closed = true;
    clearInterval(timer);
    // Decrement SSE connection counter on cleanup
    const remaining = (_sseActiveConnections.get(sseUserId) || 1) - 1;
    if (remaining <= 0) {
      _sseActiveConnections.delete(sseUserId);
    } else {
      _sseActiveConnections.set(sseUserId, remaining);
    }
  });

  await sendStatus();
});

// ===== CSRF PROTECTION SETUP - STATELESS HMAC TOKENS =====
// Uses server-signed tokens instead of cookies.
// Works across all devices/browsers regardless of third-party cookie policies.
const CSRF_SECRET =
  process.env.CSRF_SECRET || process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const CSRF_TOKEN_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

function generateCsrfToken() {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(18).toString("hex");
  const data = `${timestamp}.${random}`;
  const signature = crypto.createHmac("sha256", CSRF_SECRET).update(data).digest("hex");
  return `${data}.${signature}`;
}

function verifyCsrfToken(token) {
  if (!token || typeof token !== "string") return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [timestamp, random, signature] = parts;
  const data = `${timestamp}.${random}`;

  // Verify signature using timing-safe comparison
  const expectedSignature = crypto
    .createHmac("sha256", CSRF_SECRET)
    .update(data)
    .digest("hex");
  try {
    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expectedSignature, "hex"),
      )
    ) {
      return false;
    }
  } catch {
    return false; // Buffer length mismatch = tampered token
  }

  // Verify token age
  const tokenTime = parseInt(timestamp, 36);
  if (isNaN(tokenTime) || Date.now() - tokenTime > CSRF_TOKEN_MAX_AGE_MS) {
    return false;
  }

  return true;
}

// CSRF token endpoint
app.get("/api/csrf-token", (req, res) => {
  try {
    const token = generateCsrfToken();

    Logger.debug("CSRF token generated", {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({
      success: true,
      csrfToken: token,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Logger.error("CSRF token generation failed", {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({
      success: false,
      error: {
        code: "CSRF_GENERATION_ERROR",
        message: "Failed to generate CSRF token. Please try again.",
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// Apply CSRF protection - skip safe methods, webhooks, and health checks
app.use((req, res, next) => {
  // Skip CSRF for safe (read-only) methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  // Skip CSRF for refresh token exchange (uses refresh token in body, not cookies)
  if (req.path === "/api/auth/refresh") {
    return next();
  }

  // Skip CSRF for health checks
  if (req.path === "/api/health" || req.path === "/api/ping") {
    return next();
  }

  // Verify CSRF token from header
  const csrfToken = req.headers["x-csrf-token"];
  if (!csrfToken) {
    Logger.warn("CSRF token missing", {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    return res.status(403).json({
      success: false,
      error: {
        code: "INVALID_CSRF_TOKEN",
        message: "CSRF token missing. Please refresh the page.",
        timestamp: new Date().toISOString(),
      },
    });
  }

  if (!verifyCsrfToken(csrfToken)) {
    Logger.warn("CSRF token validation failed", {
      ip: req.ip,
      path: req.path,
      method: req.method,
      tokenLength: csrfToken.length,
    });
    return res.status(403).json({
      success: false,
      error: {
        code: "INVALID_CSRF_TOKEN",
        message: "Invalid or expired CSRF token. Please refresh the page.",
        timestamp: new Date().toISOString(),
      },
    });
  }

  next();
});

// Apply rate limiting and identity tracking BEFORE routes
app.use(identifyUser);
app.use(rateLimiter);

// ===== REGISTER ROUTES AFTER CSRF AND RATE LIMIT MIDDLEWARE =====

// B2B: Deny IT admins access to academic endpoints
// This runs AFTER authenticateToken on each route and blocks IT admins from
// viewing grades, questions, quiz results, notes, and AI features.
const academicPaths = [
  "/api/questions",
  "/api/topics",
  "/api/user/quiz",
  "/api/user/submit-exam",
  "/api/results",
  "/api/user/uploads",
  "/api/notes",
  "/api/ai",
  "/api/export",
  "/api/upload",
];
for (const p of academicPaths) {
  app.use(p, (req, res, next) => {
    // Only enforce if user is authenticated (authenticateToken sets req.user)
    if (req.user && req.user.orgRole === "it_admin") {
      return res.status(403).json({
        success: false,
        error: {
          code: "IT_ADMIN_ACADEMIC_DENIED",
          message: "IT administrators do not have access to academic data",
        },
      });
    }
    next();
  });
}

// B2B: Teacher-only content-creation gates
// Upload, AI generation, notes, and export routes are restricted to
// teacher / owner / org_admin in the B2B context.
// Students and guardians cannot create content — only consume it.
const teacherOnlyPaths = [
  "/api/upload",
  "/api/ai",
  "/api/notes",
  "/api/export",
];
const teacherAllowedRoles = ["teacher", "owner", "org_admin"];
for (const p of teacherOnlyPaths) {
  app.use(p, (req, res, next) => {
    // Only enforce for org members (B2B users have orgRole)
    if (req.user && req.user.orgRole && !teacherAllowedRoles.includes(req.user.orgRole)) {
      return res.status(403).json({
        success: false,
        error: {
          code: "TEACHER_ONLY",
          message: "This feature is only available to teachers",
        },
      });
    }
    next();
  });
}

// Public tenant-resolution endpoint — no auth required, mounted first
app.use("/api/public", publicRoutes);

app.use("/api/auth", checkDatabaseHealth);
app.use("/api/auth", authRoutes);
app.use("/api/onboarding/org", checkDatabaseHealth);
app.use("/api/onboarding/org", onboardingRoutes);
app.use("/api/org/:orgId", checkDatabaseHealth);
app.use("/api/org/:orgId", orgRoutes);
app.use("/api/org/:orgId/gradebook", checkDatabaseHealth);
app.use("/api/org/:orgId/gradebook", gradebookRoutes);
app.use("/api/org/:orgId/report-cards", checkDatabaseHealth);
app.use("/api/org/:orgId/report-cards", reportCardRoutes);
app.use("/api/org/:orgId/assignments", checkDatabaseHealth);
app.use("/api/org/:orgId/assignments", assignmentRoutes);
app.use("/api/org/:orgId/attendance", checkDatabaseHealth);
app.use("/api/org/:orgId/attendance", attendanceRoutes);
app.use("/api/org/:orgId/announcements", checkDatabaseHealth);
app.use("/api/org/:orgId/announcements", announcementRoutes);
app.use("/api/org/:orgId/guardian", checkDatabaseHealth);
app.use("/api/org/:orgId/guardian", guardianRoutes);
app.use("/api/admin", checkDatabaseHealth);
app.use("/api/upload", checkDatabaseHealth);
app.use("/api/user", checkDatabaseHealth);
app.use("/api/questions", checkDatabaseHealth);
app.use("/api/ai", checkDatabaseHealth);

app.use((req, res, next) => {
  if (req.path.startsWith("/api/auth/")) {
    return next();
  }

  if (req.path === "/api/user/submit-exam") {
    return next();
  }
  if (req.method === "GET" || req.method === "DELETE") {
    return next();
  }
  return requestValidator(req, res, next);
});

// NOTE: Primary Helmet config is at the top of the file. No duplicate needed.

const adminRateLimiter = createEndpointLimiter(
  20,
  60 * 1000,
  "Too many admin requests. Please slow down",
);
app.use("/api/admin", adminRateLimiter, adminRoutes);

(async () => {
  try {
    // MONGODB_B2B_URI takes priority over MONGODB_URI (see config/database.js).
    // The B2B deployment must point to a dedicated database, not the B2C one.
    const MONGO_URI = process.env.MONGODB_B2B_URI || process.env.MONGODB_URI;
    await connectDatabase(MONGO_URI);
    setupEventHandlers();
    Logger.info("MongoDB initialization complete");
  } catch (err) {
    Logger.error("Fatal: Cannot start without database", { error: err.message });
    process.exit(1);
  }
})();

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Handle CSRF token errors with detailed logging
  if (err.code === "EBADCSRFTOKEN") {
    Logger.error("CSRF token validation failed - DETAILED DEBUG", {
      path: req.path,
      method: req.method,
      ip: req.ip,
      headers: {
        "x-csrf-token": req.headers["x-csrf-token"],
        "content-type": req.headers["content-type"],
        origin: req.headers["origin"],
        referer: req.headers["referer"],
      },
      cookies: req.cookies,
      hasCsrfToken: !!req.headers["x-csrf-token"],
      hasCsrfCookie: !!req.cookies._csrf,
      tokenValue: req.headers["x-csrf-token"]
        ? req.headers["x-csrf-token"].substring(0, 10) + "..."
        : "NONE",
      cookieValue: req.cookies._csrf ? req.cookies._csrf.substring(0, 10) + "..." : "NONE",
      userAgent: req.headers["user-agent"],
    });
    return res.status(403).json({
      success: false,
      error: {
        code: "INVALID_CSRF_TOKEN",
        message: "Invalid or missing CSRF token. Please refresh the page and try again.",
        timestamp: new Date().toISOString(),
        debug: {
          hasToken: !!req.headers["x-csrf-token"],
          hasCookie: !!req.cookies._csrf,
        },
      },
    });
  }

  // Handle specific error types
  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      error: "VALIDATION_ERROR",
      details: err.message,
    });
  }

  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: "Invalid ID format",
      error: "INVALID_ID",
    });
  }

  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "Duplicate entry",
      error: "DUPLICATE_ENTRY",
    });
  }

  // Log unhandled errors
  Logger.error("Unhandled middleware error", {
    error: err.message,
    code: err.code,
    name: err.name,
    path: req.path,
    method: req.method,
    stack: err.stack,
  });

  // Default error response
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: "INTERNAL_ERROR",
  });
});

// B2B: Supabase Storage replaces AWS S3 for file operations.
// All storage calls go through the storageService abstraction.
const storageService = require("./services/storageService");

// Backwards-compatible helper: upload buffer and return path + URL
async function uploadToStorage(fileBuffer, fileName, mimeType, userId, orgId) {
  const relativePath = `uploads/${userId}/${Date.now()}_${fileName}`;
  const { path, publicUrl } = await storageService.upload(
    fileBuffer,
    relativePath,
    mimeType || "application/octet-stream",
    orgId || null,
    userId,
  );
  return { Key: path, url: publicUrl };
}

async function saveBackupToStorage(userId, topic, questions, orgId) {
  const relativePath = `question_backups/${userId}/${topic}_${Date.now()}.json`;
  const buffer = Buffer.from(JSON.stringify(questions, null, 2));
  const { path, publicUrl } = await storageService.upload(
    buffer,
    relativePath,
    "application/json",
    orgId || null,
    userId,
  );
  return { backupKey: path, backupUrl: publicUrl };
}

app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (data) {
    return originalJson.call(this, data);
  };
  next();
});

async function getSignedStorageUrl(Key, orgId, expirationSeconds = 1800) {
  try {
    // The Key may already be fully qualified (orgs/xxx/...) from older code paths.
    // storageService.getSignedDownloadUrl expects a relative path + orgId,
    // so if Key already starts with "orgs/" we pass orgId as null (path is absolute).
    if (Key.startsWith("orgs/")) {
      return await storageService.getSignedDownloadUrl(Key, null, expirationSeconds);
    }
    return await storageService.getSignedDownloadUrl(Key, orgId, expirationSeconds);
  } catch (err) {
    console.error("Error generating signed URL:", err);
    return null;
  }
}

// ===== HELPER FUNCTION (UPDATE) =====
function _isValidQuestion(q) {
  return (
    q &&
    q.questionText &&
    q.questionText.trim().length >= 10 &&
    q.questionText.trim().length <= 1000
  );
}

function calculateMaxTokens(questionCount) {
  const baseTokens = 500;
  const tokensPerQuestion = 180;
  const calculatedMaxTokens = baseTokens + questionCount * tokensPerQuestion;
  return Math.min(calculatedMaxTokens, 8000);
}

app.post(
  "/api/upload",
  authenticateToken,
  checkUploadLimit,
  checkFileSize,
  checkStorageLimit,
  validateFileUpload,
  trackUpload,

  async (req, res) => {
    try {
      const validatedFile = req.validatedFile;
      const { topic } = req.body;

      if (!topic || !Validators.topic(topic)) {
        return res.status(400).json({
          success: false,
          message: "Invalid topic. Use 3-10 alphanumeric characters and hyphens only",
          error: "INVALID_TOPIC",
        });
      }

      if (!validatedFile) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
          error: "NO_FILE",
        });
      }

      const file = req.files.file;

      if (!Validators.fileName(file.name)) {
        return res.status(400).json({
          success: false,
          message: "Invalid file name. No special characters or path traversal allowed.",
          error: "INVALID_FILE_NAME",
        });
      }

      const userId = new mongoose.Types.ObjectId(req.user.id);
      const fileBuffer = validatedFile.data;
      const fileName = validatedFile.sanitizedName;

      // ===== PARSE FILE =====
      let textContent = "";
      let pptxData = null;
      const ext = validatedFile.extension.toLowerCase();

      if (ext === ".pdf") {
        textContent = await parsePdf(fileBuffer);
      } else if (ext === ".docx") {
        textContent = await parseDocx(fileBuffer);
      } else if (ext === ".pptx" || ext === ".ppt") {
        try {
          pptxData = await parsePptx(fileBuffer);
          textContent = pptxData.allText || "";

          Logger.info("PowerPoint file parsed successfully", {
            format: ext,
            slides: pptxData.metadata.totalSlides,
            images: pptxData.metadata.totalImages,
            textLength: textContent.length,
          });
        } catch (pptxErr) {
          Logger.error("PowerPoint parsing failed", { error: pptxErr.message, format: ext });

          // Check if it's an old PPT format error
          if (pptxErr.message.includes("OLD_PPT_FORMAT")) {
            return res.status(400).json({
              success: false,
              error: {
                code: "OLD_PPT_FORMAT",
                message:
                  "Old .ppt files are not supported. Please convert to .pptx format (Open in PowerPoint → Save As → .pptx) or use PDF/Word format instead.",
                timestamp: new Date().toISOString(),
              },
            });
          }

          return res.status(400).json({
            success: false,
            error: {
              code: "POWERPOINT_PARSING_ERROR",
              message: "Failed to parse PowerPoint file. Please ensure it is not corrupted.",
              timestamp: new Date().toISOString(),
            },
          });
        }
      } else if (ext === ".txt") {
        textContent = fileBuffer.toString("utf8");
      } else {
        return res.status(400).json({
          success: false,
          message: "Unsupported file type. Use PDF, Word, PowerPoint (PPT/PPTX), or TXT",
        });
      }

      const normalized = cleanExtractedText(normalizeText(textContent));
      let questions = parseQuestionsFromText(normalized, topic, fileName, userId);

      //ENHANCED VALIDATION - Preserve correctAnswer from parser
      questions = questions.filter((q) => {
        // Ensure question text exists
        if (!q.questionText || q.questionText.trim().length === 0) {
          q.questionText = "AUTO-GENERATED QUESTION: " + (q.options[0] || "Unknown question");
        }

        if (!Array.isArray(q.options)) {
          q.options = [];
        }

        if (typeof q.correctAnswer === "number") {
          if (q.correctAnswer < 0 || q.correctAnswer >= q.options.length) {
            Logger.warn("Invalid correctAnswer index", {
              qnum: q.qnum,
              correctAnswer: q.correctAnswer,
              optionsLength: q.options.length,
            });
            q.correctAnswer = null;
          }
        } else if (q.correctAnswer === undefined) {
          q.correctAnswer = null;
        }

        // Validate question text length
        if (!Validators.questionText(q.questionText)) {
          console.warn(`Skipping question: invalid length`);
          return false;
        }
        return true;
      });

      //   SECOND FILTER - Type-specific validation
      questions = questions.filter((q) => {
        if (!q.questionText || q.questionText.length < 10) {
          Logger.warn("Filtering out question with invalid text", {
            qnum: q.qnum,
            textLength: q.questionText?.length,
          });
          return false;
        }

        if (!q.questionType) {
          q.questionType = "multiple-choice";
        }

        if (q.questionType === "multiple-choice" && q.options.length < 2) {
          Logger.warn("Filtering out MCQ with insufficient options", {
            qnum: q.qnum,
            optionsCount: q.options.length,
          });
          return false;
        }

        if (q.questionType === "true-false" && q.options.length !== 2) {
          Logger.warn("Filtering out T/F with wrong option count", {
            qnum: q.qnum,
            optionsCount: q.options.length,
          });
          return false;
        }

        //   Validate correctAnswer index (without resetting valid answers)
        if (typeof q.correctAnswer === "number") {
          if (q.correctAnswer < 0 || q.correctAnswer >= q.options.length) {
            q.correctAnswer = null;
          }
        }

        return true;
      });

      if (questions.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "NO_QUESTIONS_EXTRACTED",
            message: "No valid questions could be extracted from the uploaded file.",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Parallelize S3 upload, DB insert, and backup for faster processing
      // B2B: org-scoped storage upload via Supabase
      const orgId = req.user.organizationId || null;
      const [s3Result, dbResult, backupResult] = await Promise.allSettled([
        uploadToStorage(fileBuffer, fileName, file.mimetype, req.user.id, orgId),
        Question.insertMany(questions),
        saveBackupToStorage(req.user.id, topic, questions, orgId),
      ]);

      // Handle S3 upload result
      let s3FileKey = null;
      let s3Url = null;
      if (s3Result.status === "fulfilled") {
        s3FileKey = s3Result.value.Key;
        s3Url = s3Result.value.url;
        Logger.info("S3 upload successful", { s3FileKey });
      } else {
        Logger.warn("S3 upload failed (non-critical)", { error: s3Result.reason?.message });
      }

      // Handle database insert result
      if (dbResult.status === "rejected") {
        Logger.error("Database insert failed", { error: dbResult.reason?.message });
        throw new Error("Failed to save questions to database");
      }

      // Handle backup result
      let backupInfo = null;
      if (backupResult.status === "fulfilled") {
        backupInfo = backupResult.value;
        Logger.info("Backup successful", { backupKey: backupInfo?.backupKey });
      } else {
        Logger.warn("Backup failed (non-critical)", { error: backupResult.reason?.message });
      }

      await PdfLibrary.create({
        userId,
        fileName,
        topic,
        numberOfQuestions: questions.length,
        hasAnswers: questions.some((q) => q.correctAnswer !== null),
        s3FileKey,
        s3BackupKey: backupInfo?.backupKey || null,
        uploadedAt: new Date(),
        pptxMetadata: pptxData
          ? {
              totalSlides: pptxData.metadata.totalSlides,
              totalImages: pptxData.metadata.totalImages,
              slides: pptxData.slides.map((slide) => ({
                slideNumber: slide.slideNumber,
                text: slide.text,
                tables: slide.tables,
              })),
            }
          : null,
      });

      res.json({
        success: true,
        message: `Successfully extracted ${questions.length} questions.`,
        questionsAdded: questions.length,
        s3Url,
        backupUrl: backupInfo?.backupUrl || null,
      });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({
        success: false,
        error: {
          code: "UPLOAD_ERROR",
          message: "Failed to upload file. Please try again.",
          timestamp: new Date().toISOString(),
        },
      });
    }
  },
);

// ===== DELETE UPLOAD BY MONGO _ID (preferred — works even when topic name repeats) =====
app.delete("/api/uploads/id/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_ID",
          message: "Invalid upload ID",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Find the record, scoped to this user (IDOR protection)
    const upload = await PdfLibrary.findOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!upload) {
      return res.status(404).json({
        success: false,
        error: {
          code: "UPLOAD_NOT_FOUND",
          message: "Upload not found",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ── S3 cleanup ──────────────────────────────────────────────────
    const s3Keys = [upload.s3FileKey, upload.s3BundleKey, upload.s3BackupKey].filter(Boolean);
    await Promise.allSettled(
      s3Keys.map((key) =>
        storageService
          .remove(key, null)
          .then(() => Logger.info("Storage object deleted", { key }))
          .catch((err) =>
            Logger.warn("Storage delete failed (non-critical)", { key, error: err.message }),
          ),
      ),
    );

    // ── Delete questions tied to this specific record via jobId or topic ──
    // For multi-file uploads, jobId ties all questions to this one card.
    // For single-file uploads, fall back to (userId + topic) scoped delete.
    let questionsDeleted = 0;
    if (upload.jobId) {
      const qRes = await Question.deleteMany({ batchId: upload.jobId });
      questionsDeleted = qRes.deletedCount;
    } else {
      const qRes = await Question.deleteMany({
        userId: new mongoose.Types.ObjectId(userId),
        topic: upload.topic,
      });
      questionsDeleted = qRes.deletedCount;
    }

    // ── Delete the PdfLibrary record ──────────────────────────────────
    await PdfLibrary.deleteOne({ _id: upload._id });

    Logger.info("Upload deleted by ID", { userId, id, topic: upload.topic, questionsDeleted });

    return res.json({
      success: true,
      data: {
        message: `Deleted "${upload.fileName}" and ${questionsDeleted} question(s).`,
        questionsDeleted,
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Logger.error("Delete by ID error", { error: err.message, id: req.params.id });
    return res.status(500).json({
      success: false,
      error: {
        code: "DELETE_ERROR",
        message: "Failed to delete upload",
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// ===== DELETE UPLOAD BY TOPIC (legacy — kept for compatibility) =====
app.delete("/api/uploads/:topic", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { topic } = req.params; //  URL parameter - needs sanitization

    // ===== VALIDATION #1: Topic Required =====
    if (!topic || topic.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_TOPIC",
          message: "Topic is required",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== VALIDATION #2: Topic Type Check (NoSQL Injection Protection) =====
    if (typeof topic !== "string") {
      Logger.error("Non-string topic in delete upload", {
        userId,
        topicType: typeof topic,
        topic: JSON.stringify(topic),
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOPIC_TYPE",
          message: "Topic must be a string",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== VALIDATION #3: Advanced Topic Validation =====
    const { validateTopic } = require("./middleware/inputValidator");
    const topicError = validateTopic(topic);
    if (topicError) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOPIC",
          message: topicError,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== VALIDATION #4: Sanitize Topic =====
    const { sanitize } = require("./middleware/sanitizer");

    // Check for NoSQL operators
    if (sanitize.containsOperators({ topic })) {
      Logger.error("NoSQL operator detected in topic", {
        userId,
        topic,
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_CHARACTERS",
          message: "Topic contains invalid characters",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Sanitize the topic string
    const sanitizedTopic = sanitize.string(topic, false, "topic").toLowerCase(); // Lowercase to match schema

    // ===== VALIDATION #5: Path Traversal Protection =====
    if (
      sanitizedTopic.includes("..") ||
      sanitizedTopic.includes("/") ||
      sanitizedTopic.includes("\\")
    ) {
      Logger.error("Path traversal attempt in delete upload", {
        userId,
        topic: sanitizedTopic,
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOPIC_PATH",
          message: "Topic contains invalid path characters",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== VALIDATION #6: User ID Validation =====
    const userObjectId = ensureObjectId(userId);
    if (!userObjectId) {
      Logger.error("Invalid user ID in delete upload", { userId });
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_USER_ID",
          message: "Invalid user ID format",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== DATABASE QUERY: Find Uploads =====
    // Case-insensitive matching with proper regex escaping
    const escapedTopicDel = escapeRegex(sanitizedTopic);
    const uploads = await PdfLibrary.find({
      userId: userObjectId,
      topic: new RegExp(`^${escapedTopicDel}$`, "i"),
    }).lean();

    // ===== VALIDATION #7: Uploads Exist =====
    if (uploads.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: "UPLOAD_NOT_FOUND",
          message: `No uploads found for topic "${sanitizedTopic}"`,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== S3 DELETION: Delete Files =====
    const s3Errors = [];
    for (const upload of uploads) {
      // Delete main file
      if (upload.s3FileKey) {
        try {
          await storageService.remove(upload.s3FileKey, null);
          Logger.info("Storage file deleted", { key: upload.s3FileKey });
        } catch (s3Err) {
          Logger.warn("Failed to delete storage file", {
            key: upload.s3FileKey,
            error: s3Err.message,
          });
          s3Errors.push(upload.s3FileKey);
        }
      }

      // Delete backup file
      if (upload.s3BackupKey) {
        try {
          await storageService.remove(upload.s3BackupKey, null);
          Logger.info("Storage backup deleted", { key: upload.s3BackupKey });
        } catch (s3Err) {
          Logger.warn("Failed to delete storage backup", {
            key: upload.s3BackupKey,
            error: s3Err.message,
          });
          s3Errors.push(upload.s3BackupKey);
        }
      }
    }

    // ===== DATABASE OPERATIONS: Delete Questions & Uploads =====
    // Case-insensitive regex with proper escaping to prevent ReDoS
    const topicRegex = new RegExp(`^${escapedTopicDel}$`, "i");
    const [questionsResult, uploadsResult] = await Promise.allSettled([
      Question.deleteMany({
        userId: userObjectId,
        topic: topicRegex,
      }),
      PdfLibrary.deleteMany({
        userId: userObjectId,
        topic: topicRegex,
      }),
    ]);

    // Handle deletion results
    let questionsDeleted = 0;
    let uploadsDeleted = 0;

    if (questionsResult.status === "fulfilled") {
      questionsDeleted = questionsResult.value.deletedCount;
    } else {
      Logger.error("Failed to delete questions", {
        error: questionsResult.reason?.message,
      });
    }

    if (uploadsResult.status === "fulfilled") {
      uploadsDeleted = uploadsResult.value.deletedCount;
    } else {
      Logger.error("Failed to delete uploads", {
        error: uploadsResult.reason?.message,
      });
    }

    // ===== SUCCESS RESPONSE =====
    Logger.info("Upload deleted successfully", {
      userId: userId,
      topic: sanitizedTopic,
      filesDeleted: uploads.length,
      questionsDeleted,
      s3Errors: s3Errors.length,
    });

    res.json({
      success: true,
      data: {
        message: `Successfully deleted ${uploads.length} file(s) and ${questionsDeleted} question(s) for topic "${sanitizedTopic}"`,
        deletedCount: uploads.length,
        questionsDeleted,
        s3Warnings:
          s3Errors.length > 0
            ? `${s3Errors.length} S3 file(s) could not be deleted (non-critical)`
            : null,
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error("Delete upload error", {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      topic: req.params.topic,
    });

    res.status(500).json({
      success: false,
      error: {
        code: "DELETE_UPLOAD_ERROR",
        message: "Failed to delete upload. Please try again later",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// ===== DELETE SINGLE FILE FROM TOPIC =====
app.delete("/api/uploads/:topic/:filename", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { topic, filename } = req.params;

    if (!topic || !filename) {
      return res.status(400).json({
        success: false,
        error: { code: "MISSING_PARAMS", message: "Topic and filename are required" },
      });
    }

    if (typeof topic !== "string" || typeof filename !== "string") {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_PARAMS", message: "Parameters must be strings" },
      });
    }

    const sanitizedTopic = topic.trim().toLowerCase();
    const sanitizedFilename = filename.trim();

    // Find the specific file
    const upload = await PdfLibrary.findOne({
      userId,
      topic: sanitizedTopic,
      fileName: sanitizedFilename,
    });

    if (!upload) {
      return res.status(404).json({
        success: false,
        error: { code: "FILE_NOT_FOUND", message: "File not found" },
      });
    }

    // Delete from S3
    const s3Errors = [];
    const keysToDelete = [upload.s3FileKey, upload.s3BackupKey].filter(Boolean);

    for (const key of keysToDelete) {
      try {
        await storageService.remove(key, null);
      } catch (s3Err) {
        s3Errors.push(key);
        Logger.warn("Storage delete failed for single file", { key, error: s3Err.message });
      }
    }

    // Delete questions for this specific file
    const questionsDeleted = await Question.deleteMany({
      userId,
      topic: sanitizedTopic,
      fileName: sanitizedFilename,
    });

    // Update user storage
    const user = await User.findById(userId);
    if (user && upload.s3FileKey) {
      // Estimate file size reduction (approximate)
      await user.reduceStorageUsage(0.1);
    }

    // Delete the PdfLibrary entry
    await PdfLibrary.deleteOne({ _id: upload._id });

    Logger.info("Single file deleted", {
      userId,
      topic: sanitizedTopic,
      filename: sanitizedFilename,
    });

    res.json({
      success: true,
      data: {
        message: `Successfully deleted "${sanitizedFilename}" from topic "${sanitizedTopic}"`,
        questionsDeleted: questionsDeleted.deletedCount,
        s3Warnings:
          s3Errors.length > 0 ? `${s3Errors.length} S3 file(s) could not be deleted` : null,
      },
    });
  } catch (error) {
    Logger.error("Delete single file error", { error: error.message, userId: req.user?.id });
    res.status(500).json({
      success: false,
      error: { code: "DELETE_FILE_ERROR", message: "Failed to delete file" },
    });
  }
});

// ===== BULK UPLOAD ENDPOINT =====
const BulkUploadJob = require("./models/BulkUploadJob");

app.post("/api/upload/bulk", authenticateToken, checkUploadLimit, async (req, res) => {
  try {
    const userId = req.user.id;
    const { topic } = req.body;

    if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: "MISSING_TOPIC", message: "Topic is required" },
      });
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      return res
        .status(400)
        .json({ success: false, error: { code: "NO_FILES", message: "No files uploaded" } });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }

    // Normalize files to array
    let files = req.files.files || req.files.file;
    if (!Array.isArray(files)) files = [files];

    // Check tier file limit — always read live from PricingConfig so
    // stale user.limits in the DB never incorrectly blocks a higher-tier user
    const PricingConfigModel = require("./models/PricingConfig");
    const pricingCfg = await PricingConfigModel.getConfig();
    const bulkTier = user.subscriptionTier || "free";
    const bulkTierLimits = pricingCfg?.tiers?.[bulkTier]?.limits || {};
    const maxFiles = bulkTierLimits.filesPerUpload || 1;
    if (maxFiles !== -1 && files.length > maxFiles) {
      return res.status(403).json({
        success: false,
        error: {
          code: "FILE_LIMIT_EXCEEDED",
          message: `Your plan allows ${maxFiles} file(s) per upload. You uploaded ${files.length}.`,
          limit: maxFiles,
          uploaded: files.length,
        },
      });
    }

    const sanitizedTopic = topic.trim().toLowerCase();

    // Create bulk job
    const job = await BulkUploadJob.create({
      userId,
      topic: sanitizedTopic,
      totalFiles: files.length,
      files: files.map((f) => ({ fileName: f.name, status: "pending" })),
      startedAt: new Date(),
    });

    // Process files sequentially (to avoid memory overload)
    let totalQuestions = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        job.files[i].status = "processing";
        await job.save();

        // Extract text
        const tempPath = `/tmp/bulk_${Date.now()}_${file.name}`;
        const fs = require("fs");
        fs.writeFileSync(tempPath, file.data);
        const text = await extractTextFromUpload(tempPath, file.name);
        try {
          fs.unlinkSync(tempPath);
        } catch (_) {}

        if (!text || text.trim().length < 20) {
          job.files[i].status = "failed";
          job.files[i].error = "Could not extract sufficient text from file";
          continue;
        }

        // Upload to Supabase storage\n        const s3Key = `uploads/${userId}/${sanitizedTopic}/${Date.now()}_${file.name}`;\n        const { path: uploadedPath } = await storageService.upload(\n          file.data,\n          s3Key,\n          file.mimetype,\n          req.user.organizationId || null,\n          userId,\n        );

        // Parse questions from text
        const questions = await parseQuestionsFromText(text);

        if (questions.length > 0) {
          // Save questions to DB
          const questionsToSave = questions.map((q) => ({
            ...q,
            userId,
            topic: sanitizedTopic,
            fileName: file.name,
            source: "bulk_upload",
          }));

          const inserted = await Question.insertMany(questionsToSave, { ordered: false });

          // Create PdfLibrary entry
          await PdfLibrary.findOneAndUpdate(
            { userId, topic: sanitizedTopic, fileName: file.name },
            {
              userId,
              topic: sanitizedTopic,
              fileName: file.name,
              s3FileKey: s3Key,
              numberOfQuestions: inserted.length,
              hasAnswers: inserted.some((q) => q.correctAnswer || q.answer),
              uploadedAt: new Date(),
            },
            { upsert: true, new: true },
          );

          job.files[i].questionsGenerated = inserted.length;
          job.files[i].s3FileKey = s3Key;
          totalQuestions += inserted.length;
        }

        job.files[i].status = "completed";
        job.files[i].processedAt = new Date();
        job.processedFiles++;
      } catch (fileErr) {
        Logger.error("Bulk upload file error", {
          fileName: file.name,
          error: fileErr.message,
        });
        job.files[i].status = "failed";
        job.files[i].error = fileErr.message;
      }
    }

    // Finalize job
    job.totalQuestionsGenerated = totalQuestions;
    job.completedAt = new Date();
    job.status = job.files.every((f) => f.status === "completed")
      ? "completed"
      : job.files.every((f) => f.status === "failed")
        ? "failed"
        : "partial";
    await job.save();

    // Track upload count
    if (user.usage) {
      user.usage.uploadsThisMonth += files.length;
      user.usage.questionsGenerated += totalQuestions;
      await user.save();
    }

    Logger.info("Bulk upload completed", {
      userId,
      topic: sanitizedTopic,
      files: files.length,
      questions: totalQuestions,
    });

    res.json({
      success: true,
      data: {
        jobId: job._id,
        status: job.status,
        totalFiles: files.length,
        processedFiles: job.processedFiles,
        totalQuestionsGenerated: totalQuestions,
        files: job.files.map((f) => ({
          fileName: f.fileName,
          status: f.status,
          questionsGenerated: f.questionsGenerated,
          error: f.error || null,
        })),
      },
    });
  } catch (err) {
    Logger.error("Bulk upload error", { error: err.message, stack: err.stack });
    res.status(500).json({
      success: false,
      error: { code: "BULK_UPLOAD_ERROR", message: "Failed to process bulk upload" },
    });
  }
});

// ===== GET BULK UPLOAD JOB STATUS =====
app.get("/api/upload/bulk/:jobId", authenticateToken, async (req, res) => {
  try {
    const job = await BulkUploadJob.findOne({
      _id: req.params.jobId,
      userId: req.user.id,
    }).lean();
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: "JOB_NOT_FOUND", message: "Upload job not found" },
      });
    }
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to fetch job status" },
    });
  }
});

// Helpers to extract text from files (reusing existing PDF/DOCX loaders)
async function extractTextFromUpload(tempFilePath, originalName) {
  const lower = (originalName || "").toLowerCase();
  if (lower.endsWith(".pdf")) {
    const dataBuffer = fs.readFileSync(tempFilePath);
    return await parsePdf(dataBuffer);
  }
  if (lower.endsWith(".docx")) {
    const dataBuffer = fs.readFileSync(tempFilePath);
    return await parseDocx(dataBuffer);
  }
  if (lower.endsWith(".txt")) {
    return fs.readFileSync(tempFilePath, "utf8");
  }
  // Fallback: try reading as text
  try {
    return fs.readFileSync(tempFilePath, "utf8");
  } catch (_) {
    return "";
  }
}

// --- AI: Enhanced Document Processing and Parsing ---

// ===== PDF EXPORT ENDPOINT =====
app.post("/api/export/pdf", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }

    // Tier check: pdfExport is true for starter and pro tiers
    if (!user.limits.pdfExport) {
      return res.status(403).json({
        success: false,
        error: {
          code: "TIER_RESTRICTED",
          message:
            "PDF export is available on Pro plan and above. Please upgrade your subscription.",
          requiredTier: "pro",
        },
      });
    }

    const {
      topic,
      difficulty,
      includeAnswers = true,
      format = "questions",
      fontSize = 11,
      fontFamily = "Helvetica",
    } = req.body;

    if (!topic || typeof topic !== "string") {
      return res.status(400).json({
        success: false,
        error: { code: "MISSING_TOPIC", message: "Topic is required" },
      });
    }

    // Validate fontSize (8-18 range)
    const safeFontSize = Math.min(18, Math.max(8, Number(fontSize) || 11));
    // Validate fontFamily
    const allowedFonts = ["Helvetica", "Times", "Courier"];
    const safeFontFamily = allowedFonts.includes(fontFamily) ? fontFamily : "Helvetica";

    // Build query
    const query = { userId, topic: topic.toLowerCase().trim() };
    if (difficulty && ["easy", "medium", "hard"].includes(difficulty)) {
      query.difficulty = difficulty;
    }

    const questions = await Question.find(query).lean();

    if (!questions || questions.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: "NO_QUESTIONS", message: "No questions found for this topic" },
      });
    }

    const pdfBuffer =
      format === "exam"
        ? await pdfExportService.generateExamPDF(questions, {
            topic: topic.trim(),
            userName: user.fullname || user.username,
            difficulty,
            fontSize: safeFontSize,
            fontFamily: safeFontFamily,
          })
        : await pdfExportService.generateQuestionsPDF(questions, {
            topic: topic.trim(),
            userName: user.fullname || user.username,
            difficulty,
            includeAnswers,
            fontSize: safeFontSize,
            fontFamily: safeFontFamily,
          });

    const safeTopicName = topic
      .trim()
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .substring(0, 50);
    const filename = `${safeTopicName}_${format === "exam" ? "exam" : "questions"}_${Date.now()}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

    Logger.info("PDF exported", { userId, topic, questionCount: questions.length, format });
  } catch (err) {
    Logger.error("PDF export error", { error: err.message, stack: err.stack });
    res.status(500).json({
      success: false,
      error: { code: "PDF_EXPORT_ERROR", message: "Failed to generate PDF" },
    });
  }
});

// ===== NOTE SUMMARIZATION ENDPOINT (Local NLP, No AI Cost) =====
app.post("/api/notes/summarize", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }

    // Tier check: noteSummary is true for starter and pro tiers
    if (!user.limits.noteSummary) {
      return res.status(403).json({
        success: false,
        error: {
          code: "TIER_RESTRICTED",
          message:
            "Note summarization is available on Pro plan and above. Please upgrade your subscription.",
          requiredTier: "pro",
        },
      });
    }

    // Accept either file upload or text body
    let text = "";
    if (req.files && req.files.file) {
      const file = req.files.file;
      const tempPath = `/tmp/summarize_${Date.now()}_${file.name}`;
      await file.mv(tempPath);
      text = await extractTextFromUpload(tempPath, file.name);
      try {
        fs.unlinkSync(tempPath);
      } catch (_) {}
    } else if (req.body.text && typeof req.body.text === "string") {
      text = req.body.text;
    } else {
      return res.status(400).json({
        success: false,
        error: { code: "NO_CONTENT", message: "Provide a file or text to summarize" },
      });
    }

    if (!text || text.trim().length < 50) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INSUFFICIENT_TEXT",
          message: "Text is too short to summarize (minimum 50 characters)",
        },
      });
    }

    // Local NLP summarization (no AI cost)
    const summary = localSummarize(text, req.body.maxSentences || 10);

    res.json({
      success: true,
      data: {
        summary: summary.text,
        keyPoints: summary.keyPoints,
        wordCount: summary.wordCount,
        originalWordCount: text.split(/\s+/).length,
        compressionRatio: summary.compressionRatio,
      },
    });

    Logger.info("Note summarized", {
      userId,
      originalLength: text.length,
      summaryLength: summary.text.length,
    });
  } catch (err) {
    Logger.error("Note summarization error", { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: "SUMMARIZE_ERROR", message: "Failed to summarize notes" },
    });
  }
});

/**
 * Local NLP Summarization (zero cost - no API calls)
 * Uses extractive summarization with TF-IDF-like scoring
 */
function localSummarize(text, maxSentences = 10) {
  // Clean and split into sentences
  const cleaned = text.replace(/\s+/g, " ").trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];

  if (sentences.length <= maxSentences) {
    return {
      text: sentences.join(" ").trim(),
      keyPoints: sentences.map((s) => s.trim()).filter((s) => s.length > 10),
      wordCount: cleaned.split(/\s+/).length,
      compressionRatio: 1,
    };
  }

  // Build word frequency map (simple TF)
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "is",
    "was",
    "are",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "them",
    "its",
    "his",
    "her",
    "our",
    "their",
    "my",
    "your",
    "what",
    "which",
    "who",
    "whom",
    "how",
    "when",
    "where",
    "why",
    "not",
    "no",
    "nor",
    "as",
    "if",
    "then",
    "so",
    "than",
    "too",
    "very",
    "just",
    "also",
  ]);

  const wordFreq = {};
  const words = cleaned.toLowerCase().split(/\s+/);
  for (const w of words) {
    const clean = w.replace(/[^a-z0-9]/g, "");
    if (clean.length > 2 && !stopWords.has(clean)) {
      wordFreq[clean] = (wordFreq[clean] || 0) + 1;
    }
  }

  // Score each sentence
  const scored = sentences.map((sentence, idx) => {
    const sentWords = sentence.toLowerCase().split(/\s+/);
    let score = 0;
    for (const w of sentWords) {
      const clean = w.replace(/[^a-z0-9]/g, "");
      if (wordFreq[clean]) score += wordFreq[clean];
    }
    // Normalize by sentence length
    score = sentWords.length > 0 ? score / sentWords.length : 0;
    // Boost first and early sentences (positional bias)
    if (idx === 0) score *= 1.5;
    else if (idx < 3) score *= 1.2;
    return { sentence: sentence.trim(), score, idx };
  });

  // Sort by score, take top N, then re-sort by original position
  const topSentences = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.idx - b.idx);

  const summaryText = topSentences.map((s) => s.sentence).join(" ");
  const summaryWords = summaryText.split(/\s+/).length;

  // Extract key points (top 5 highest-scored sentences)
  const keyPoints = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.sentence);

  return {
    text: summaryText,
    keyPoints,
    wordCount: summaryWords,
    compressionRatio: Math.round((summaryWords / words.length) * 100) / 100,
  };
}

app.post(
  "/api/ai/summarize",
  authenticateToken,
  checkTokenLimit(1500),
  trackTokenUsage,
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: { code: "USER_NOT_FOUND", message: "User not found" },
        });
      }

      if (!user.limits?.noteSummary) {
        return res.status(403).json({
          success: false,
          error: {
            code: "TIER_RESTRICTED",
            message:
              "AI note summary is available on Pro plan and above. Please upgrade your subscription.",
            requiredTier: "pro",
          },
        });
      }

      let result;
      if (req.files && req.files.file) {
        const file = req.files.file;
        result = await aiService.summarizeDocument(file);
      } else if (req.body.text && typeof req.body.text === "string") {
        result = await aiService.summarizeText(req.body.text);
      } else {
        return res.status(400).json({
          success: false,
          error: {
            code: "NO_CONTENT",
            message: "Provide a file or text to summarize",
            timestamp: new Date().toISOString(),
          },
        });
      }

      res.json({ content: result.content });
    } catch (err) {
      Logger.error("AI summarize error:", { error: err.message });
      res.status(500).json({
        success: false,
        error: {
          code: "AI_SUMMARIZE_ERROR",
          message: err.message || "Failed to summarize document",
          timestamp: new Date().toISOString(),
        },
      });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING SUMMARISE ENDPOINTS
//   POST /api/ai/summarize-start  — validate, hash, dedup, S3 upload, create session, stream
//   GET  /api/ai/summarize-stream/:jobId — ndjson stream that pushes chapters as they complete
//   GET  /api/ai/summary-sessions — user's session history
//   GET  /api/ai/summary-sessions/:sessionId — load a saved session
//   PUT  /api/ai/summary-sessions/:sessionId/chat — auto-save chat messages
//   PUT  /api/ai/summary-sessions/:sessionId/position — save chapter position + tab
//   DELETE /api/ai/summary-sessions/:sessionId — delete a session
//   POST /api/ai/summary-sessions/:sessionId/generate-quiz — generate quiz from saved file
//   POST /api/ai/summary-sessions/:sessionId/quick-check — 5-question comprehension quiz
// ─────────────────────────────────────────────────────────────────────────────

// Helper: upload summary source file to Supabase storage
async function _uploadSummaryFileToStorage(userId, fileBuffer, fileName, orgId) {
  const ext = (fileName.match(/\.[^.]+$/) || [".bin"])[0];
  const relativePath = `summary-sources/${userId}/${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`;
  const { path } = await storageService.upload(
    fileBuffer,
    relativePath,
    "application/octet-stream",
    orgId || null,
    userId,
  );
  return path;
}

// Helper: download summary source file from Supabase storage
async function _downloadSummaryFileFromStorage(storagePath) {
  const { buffer } = await storageService.download(storagePath, null);
  return buffer;
}

app.post(
  "/api/ai/summarize-start",
  authenticateToken,
  checkTokenLimit(1500),
  trackTokenUsage,
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: { code: "USER_NOT_FOUND", message: "User not found" },
        });
      }
      if (!user.limits?.noteSummary) {
        return res.status(403).json({
          success: false,
          error: {
            code: "TIER_RESTRICTED",
            message: "AI note summary is available on Pro plan and above.",
            requiredTier: "pro",
          },
        });
      }

      // ── Normalize uploaded files to array ──
      let uploadedFiles = [];
      if (req.files && req.files.file) {
        const raw = req.files.file;
        uploadedFiles = Array.isArray(raw) ? raw : [raw];
      }
      const hasFiles = uploadedFiles.length > 0;

      const bodyText = (req.body || {}).text;
      const hasText = typeof bodyText === "string" && bodyText.trim().length >= 50;
      if (!hasFiles && !hasText) {
        return res.status(400).json({
          success: false,
          error: {
            code: "NO_CONTENT",
            message: "Provide a file or at least 50 characters of text.",
          },
        });
      }

      // ── Multi-file tier check ──
      if (uploadedFiles.length > 1) {
        // Hard security cap
        if (uploadedFiles.length > ABSOLUTE_MAX_FILES) {
          return res.status(413).json({
            success: false,
            error: {
              code: "FILE_COUNT_EXCEEDED",
              message: `Maximum ${ABSOLUTE_MAX_FILES} files per upload. You sent ${uploadedFiles.length}.`,
            },
          });
        }
        const PricingConfig = require("./models/PricingConfig");
        const pricingConfig = await PricingConfig.getConfig();
        const userTier = user.subscriptionTier || "free";
        const tierLimits = pricingConfig?.tiers?.[userTier]?.limits || {};
        const maxFilesAllowed = tierLimits.filesPerUpload || 1;
        if (uploadedFiles.length > maxFilesAllowed) {
          return res.status(403).json({
            success: false,
            error: {
              code: "FILE_COUNT_EXCEEDED",
              message: `Your ${userTier} plan allows up to ${maxFilesAllowed} file(s) per upload. You uploaded ${uploadedFiles.length}.`,
              maxFiles: maxFilesAllowed,
              uploadedFiles: uploadedFiles.length,
            },
          });
        }
        // Validate each file via the multi-file validator (security checks)
        await new Promise((resolve, reject) => {
          validateMultiFileUpload(
            req,
            {
              status: (code) => ({
                json: (body) =>
                  reject(
                    Object.assign(
                      new Error(body?.error?.message || "File validation failed"),
                      { statusCode: code, responseBody: body },
                    ),
                  ),
              }),
            },
            resolve,
          );
        });
      }

      // ── Compute combined file hash for dedup ──
      let rawContent, fileHash, fileName, fileSize;
      if (hasFiles) {
        if (uploadedFiles.length === 1) {
          rawContent = uploadedFiles[0].data;
          fileName = uploadedFiles[0].name;
        } else {
          // Combined hash: sort individual hashes for order-independent dedup
          const perFileHashes = uploadedFiles.map((f) =>
            crypto.createHash("sha256").update(f.data).digest("hex"),
          );
          perFileHashes.sort();
          rawContent = Buffer.concat(uploadedFiles.map((f) => f.data));
          fileName = uploadedFiles.map((f) => f.name).join(" + ");
          fileHash = crypto.createHash("sha256").update(perFileHashes.join("|")).digest("hex");
        }
        fileSize = rawContent.length;
        if (!fileHash) fileHash = crypto.createHash("sha256").update(rawContent).digest("hex");
      } else {
        rawContent = Buffer.from(bodyText.trim(), "utf8");
        fileHash = crypto.createHash("sha256").update(rawContent).digest("hex");
        fileName = "study-notes.txt";
        fileSize = rawContent.length;
      }

      // ── Dedup check: does this user already have this file summarized? ──
      const existingSession = await SummarySession.findByFileHash(req.user.id, fileHash);
      if (existingSession && existingSession.status === "complete") {
        Logger.info("summarize-start: dedup hit, returning existing session", {
          sessionId: existingSession._id,
          userId: req.user.id,
        });
        return res.json({
          success: true,
          deduplicated: true,
          sessionId: existingSession._id.toString(),
          message: `You have an existing summary of "${existingSession.sourceFileName}" — loading it now.`,
        });
      }

      // ── Upload source file(s) to S3 ──
      let s3Key = null;
      try {
        s3Key = await _uploadSummaryFileToStorage(
          req.user.id,
          rawContent,
          fileName,
          req.user.organizationId,
        );
      } catch (s3Err) {
        Logger.warn("summarize-start: Storage upload failed, continuing without storage", {
          error: s3Err.message,
        });
      }

      // ── Create SummarySession in MongoDB ──
      const session = await SummarySession.create({
        userId: req.user.id,
        sourceFileName: fileName,
        sourceFileHash: fileHash,
        sourceFileSize: fileSize,
        s3Key,
        title: "Generating…",
        status: "streaming",
        chatHistory: [
          {
            role: "assistant",
            content: `Hey ${user.fullname?.split(" ")[0] || "there"}, what do you need clarity on?`,
          },
        ],
      });

      // Enforce session limit (delete oldest beyond 20)
      SummarySession.enforceSessionLimit(req.user.id, 20).catch((err) => {
        Logger.warn("enforceSessionLimit error", { error: err.message });
      });

      const sessionId = session._id.toString();

      // ── Create in-memory job (for ndjson streaming) ──
      const jobId = _summaryJobCreate(req.user.id);
      // Attach sessionId to the job so the emitter can persist to MongoDB
      const job = _summaryJobStore.get(jobId);
      if (job) job.sessionId = sessionId;

      const fileCount = uploadedFiles.length;
      Logger.info("summarize-start job created", {
        jobId,
        sessionId,
        userId: req.user.id,
        hasFiles,
        fileCount,
      });

      // Return immediately so the client can open the stream
      res.json({ success: true, jobId, sessionId });

      // ── Snapshot files before response ends (express-fileupload may release buffers) ──
      const filesToProcess = hasFiles
        ? uploadedFiles.map((f) => ({ data: Buffer.from(f.data), name: f.name }))
        : [];

      // ── Background: extract, chunk, generate chapters, fire callbacks ──
      setImmediate(async () => {
        try {
          // For multi-file: pass as files array; for single: pass as single file
          const streamArgs = {
            file: filesToProcess.length === 1 ? filesToProcess[0] : null,
            files: filesToProcess.length > 1 ? filesToProcess : null,
            text: hasText ? bodyText.trim() : null,
            fileName: hasFiles
              ? filesToProcess.length === 1
                ? filesToProcess[0].name
                : filesToProcess.map((f) => f.name).join(" + ")
              : "study-notes",
            onTitle: async (title) => {
              _summaryJobEmit(jobId, { type: "title", title });
              try {
                await SummarySession.updateOne({ _id: sessionId }, { title });
              } catch {}
            },
            onChapter: async (chapter) => {
              _summaryJobEmit(jobId, { type: "chapter", chapter });
              try {
                await SummarySession.updateOne(
                  { _id: sessionId },
                  { $push: { chapters: chapter } },
                );
              } catch {}
            },
            onComplete: async (totalChapters) => {
              _summaryJobEmit(jobId, { type: "complete", totalChapters });
              try {
                await SummarySession.updateOne(
                  { _id: sessionId },
                  {
                    status: "complete",
                    totalExpectedChunks: totalChapters,
                  },
                );
              } catch {}
            },
            onError: async (message) => {
              _summaryJobEmit(jobId, { type: "error", message });
              try {
                await SummarySession.updateOne({ _id: sessionId }, { status: "failed" });
              } catch {}
            },
          };
          await aiService.summarizeDocumentStreaming(streamArgs);
        } catch (bgErr) {
          Logger.error("summarize-start background error", { jobId, error: bgErr.message });
          _summaryJobEmit(jobId, {
            type: "error",
            message: bgErr.message || "Processing failed",
          });
          try {
            await SummarySession.updateOne({ _id: sessionId }, { status: "failed" });
          } catch {}
        }
      });
    } catch (err) {
      Logger.error("summarize-start error", { error: err.message });
      // Handle file validation rejection from the inline multi-file validator
      if (err.statusCode && err.responseBody) {
        return res.status(err.statusCode).json(err.responseBody);
      }
      res
        .status(500)
        .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
    }
  },
);

app.get("/api/ai/summarize-stream/:jobId", authenticateToken, async (req, res) => {
  const jobId = decodeURIComponent(req.params.jobId || "");
  if (!jobId) {
    return res.status(400).json({ error: "Job ID required" });
  }

  const job = _summaryJobStore.get(jobId);
  if (!job) {
    return res.status(404).json({ error: "Summary job not found or expired" });
  }
  if (job.userId !== req.user.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Set up ndjson stream (same transport as quiz job stream)
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Flush already-arrived data (job may have progressed before client connected)
  if (job.title) {
    res.write(JSON.stringify({ type: "title", title: job.title }) + "\n");
  }
  for (const ch of job.chapters) {
    res.write(JSON.stringify({ type: "chapter", chapter: ch }) + "\n");
  }

  // Job already finished before client arrived — send terminal event and close
  if (job.status === "completed") {
    res.write(JSON.stringify({ type: "complete", totalChapters: job.chapters.length }) + "\n");
    res.end();
    return;
  }
  if (job.status === "failed") {
    res.write(
      JSON.stringify({ type: "error", message: job.error || "Processing failed" }) + "\n",
    );
    res.end();
    return;
  }

  // Job still running — register this response as the live client
  job.client = res;
  req.on("close", () => {
    if (job.client === res) job.client = null;
  });
});

// ── GET /api/ai/summary-sessions — list user's saved sessions ──
app.get("/api/ai/summary-sessions", authenticateToken, async (req, res) => {
  try {
    const sessions = await SummarySession.getUserSessions(req.user.id, 20);
    res.json({ success: true, sessions });
  } catch (err) {
    Logger.error("summary-sessions list error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
  }
});

// ── GET /api/ai/summary-sessions/:id — load full session (includes chat) ──
app.get("/api/ai/summary-sessions/:id", authenticateToken, async (req, res) => {
  try {
    const session = await SummarySession.findOne({
      _id: req.params.id,
      userId: req.user.id,
    }).lean();
    if (!session)
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Session not found" } });
    res.json({ success: true, session });
  } catch (err) {
    Logger.error("summary-session load error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
  }
});

// ── PUT /api/ai/summary-sessions/:id/chat — append chat messages (auto-save after each exchange) ──
app.put("/api/ai/summary-sessions/:id/chat", authenticateToken, async (req, res) => {
  try {
    const { messages } = req.body; // array of { role, content }
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID", message: "messages array required" },
      });
    }
    // Sanitise and push
    const toAdd = messages.map((m) => ({
      role: m.role,
      content: (m.content || "").slice(0, 20000),
      timestamp: new Date(),
    }));
    await SummarySession.updateOne(
      { _id: req.params.id, userId: req.user.id },
      { $push: { chatHistory: { $each: toAdd } } },
    );
    res.json({ success: true });
  } catch (err) {
    Logger.error("summary-session chat save error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
  }
});

// ── PUT /api/ai/summary-sessions/:id/position — save chapter position + tab ──
app.put("/api/ai/summary-sessions/:id/position", authenticateToken, async (req, res) => {
  try {
    const { lastChapterIdx, lastTab, lastSubChapterNum } = req.body;
    const update = {};
    if (typeof lastChapterIdx === "number") update.lastChapterIdx = lastChapterIdx;
    if (lastTab) update.lastTab = lastTab;
    if (typeof lastSubChapterNum === "number") update.lastSubChapterNum = lastSubChapterNum;
    await SummarySession.updateOne({ _id: req.params.id, userId: req.user.id }, update);
    res.json({ success: true });
  } catch (err) {
    Logger.error("summary-session position save error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
  }
});

// ── PUT /api/ai/summary-sessions/:id/annotations — save highlights + user notes ──
app.put("/api/ai/summary-sessions/:id/annotations", authenticateToken, async (req, res) => {
  try {
    const { highlights, userNotes } = req.body;
    const update = {};
    // Accept any object/array structure — stored as Mixed
    if (highlights !== undefined && typeof highlights === "object")
      update.highlights = highlights;
    if (userNotes !== undefined && typeof userNotes === "object") update.userNotes = userNotes;
    if (Object.keys(update).length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID", message: "highlights or userNotes object required" },
      });
    }
    await SummarySession.updateOne(
      { _id: req.params.id, userId: req.user.id },
      { $set: update },
    );
    res.json({ success: true });
  } catch (err) {
    Logger.error("summary-session annotations save error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
  }
});

// ── DELETE /api/ai/summary-sessions/:id — delete a session ──
app.delete("/api/ai/summary-sessions/:id", authenticateToken, async (req, res) => {
  try {
    const session = await SummarySession.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    });
    if (!session)
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Session not found" } });
    // Clean up S3 file (fire-and-forget)
    if (session.s3Key) {
      storageService.remove(session.s3Key, null).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    Logger.error("summary-session delete error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ─── Course Outline Routes ───────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════

const courseOutlineService = require("./services/courseOutlineService");
const outlineGenerationService = require("./services/outlineGenerationService");

// ── POST /api/ai/course-outline/parse — Pre-flight: detect + parse outline ──
app.post(
  "/api/ai/course-outline/parse",
  authenticateToken,
  createEndpointLimiter(10, 60 * 1000, "Too many parse requests. Please slow down."),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: { code: "USER_NOT_FOUND", message: "User not found" },
        });
      }
      if (!user.limits?.noteSummary) {
        return res.status(403).json({
          success: false,
          error: {
            code: "TIER_RESTRICTED",
            message: "Course outline notes are available on Pro plan and above.",
            requiredTier: "pro",
          },
        });
      }

      // ── Accept text body, single file, or multiple files ──
      let rawText = "";
      let primaryFileName = "";
      const bodyText = (req.body || {}).text;

      // Normalize file(s): express-fileupload gives an array when multiple files
      // share the same field name, or a single object for one file.
      const rawFile = req.files && (req.files.file || req.files.files);
      const fileList = rawFile ? (Array.isArray(rawFile) ? rawFile : [rawFile]) : [];

      // Helper: extract text from a single uploaded file
      const extractTextFromFile = async (file) => {
        const ext = path.extname(file.name).toLowerCase();
        try {
          if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
            // Local OCR — zero API cost, sharp + Tesseract.js
            const imageOcrService = require("./services/imageOcrService");
            const ocrResult = await imageOcrService.ocrImage(file.data, file.name, {
              document: true,
            });
            return ocrResult?.text || "";
          } else if (ext === ".pdf") {
            // parsePdf returns a string directly
            const text = await parsePdf(file.data);
            return typeof text === "string" ? text : text?.text || "";
          } else if (ext === ".docx") {
            // parseDocx returns a string directly
            const text = await parseDocx(file.data);
            return typeof text === "string" ? text : text?.text || "";
          } else if (ext === ".txt") {
            return file.data.toString("utf8");
          }
          return null; // unsupported extension
        } catch (parseErr) {
          Logger.warn("course-outline/parse: file extraction error", {
            fileName: file.name,
            ext,
            error: parseErr.message,
          });
          return ""; // treat failed parse as empty text — let INSUFFICIENT_CONTENT catch it
        }
      };

      if (fileList.length > 0) {
        // ── Multi-file path: extract from each, combine with markers ──
        primaryFileName = fileList[0].name; // use first file's name for detection
        const textParts = [];
        const unsupported = [];

        for (const file of fileList) {
          const extracted = await extractTextFromFile(file);
          if (extracted === null) {
            unsupported.push(file.name);
          } else if (extracted.trim()) {
            textParts.push(extracted);
          }
        }

        if (textParts.length === 0 && unsupported.length > 0) {
          return res.status(400).json({
            success: false,
            error: {
              code: "UNSUPPORTED_FILE",
              message: "Supported formats: PDF, DOCX, TXT, JPG, PNG, WEBP",
            },
          });
        }

        // For outline detection, combine all text (outlines may span files)
        rawText = textParts.join("\n\n");
      } else if (typeof bodyText === "string" && bodyText.trim().length >= 30) {
        rawText = bodyText.trim();
      } else {
        return res.status(400).json({
          success: false,
          error: {
            code: "NO_CONTENT",
            message: "Provide a file or at least 30 characters of text.",
          },
        });
      }

      if (rawText.trim().length < 30) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INSUFFICIENT_CONTENT",
            message: "Could not extract enough text. Ensure the content is readable.",
          },
        });
      }

      // Determine user tier
      const userTier = user.tier || "pro";

      // Run analysis with filename-aware detection
      const analysis = courseOutlineService.analyzeOutline(rawText, userTier, primaryFileName);

      // Check for dedup
      const existingSession = await SummarySession.findByFileHash(
        req.user.id,
        analysis.contentHash,
      );
      const deduplicated =
        existingSession &&
        existingSession.status === "complete" &&
        existingSession.sessionType === "course_outline";

      // ── Diagnostic: log OCR text sample + chapter structures for debugging ──
      Logger.info("course-outline/parse OCR text sample", {
        userId: req.user.id,
        textLength: rawText.length,
        first500: rawText.substring(0, 500),
      });
      Logger.info("course-outline/parse chapter details", {
        userId: req.user.id,
        chapterSummary: analysis.chapters.map((ch, i) => ({
          idx: i,
          weekNumber: ch.weekNumber,
          chapterTitle: ch.chapterTitle || "(MISSING)",
          subTopics: (ch.subTopics || []).length,
        })),
      });

      Logger.info("course-outline/parse complete", {
        userId: req.user.id,
        isOutline: analysis.isOutline,
        confidence: analysis.confidence,
        chapters: analysis.totalChapters,
        subTopics: analysis.totalSubTopics,
        depthTier: analysis.depthTier,
        fileCount: fileList.length || 0,
        primaryFileName: primaryFileName || "(text)",
        deduplicated: !!deduplicated,
      });

      res.json({
        success: true,
        ...analysis,
        sourceFileSize: rawText.length,
        fileCount: fileList.length || 0,
        deduplicated: !!deduplicated,
        existingSessionId: deduplicated ? existingSession._id.toString() : null,
      });
    } catch (err) {
      Logger.error("course-outline/parse error", { error: err.message, stack: err.stack });
      res.status(500).json({
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: "An internal error occurred. Please try again.",
        },
      });
    }
  },
);

// ── POST /api/ai/course-outline/generate — Start outline generation ──
app.post(
  "/api/ai/course-outline/generate",
  authenticateToken,
  checkTokenLimit(3000),
  trackTokenUsage,
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: { code: "USER_NOT_FOUND", message: "User not found" },
        });
      }
      if (!user.limits?.noteSummary) {
        return res.status(403).json({
          success: false,
          error: {
            code: "TIER_RESTRICTED",
            message: "Course outline notes are available on Pro plan and above.",
            requiredTier: "pro",
          },
        });
      }

      const { chapters, courseName, depthTier, contentHash, sourceFileSize } = req.body;

      if (!Array.isArray(chapters) || chapters.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID", message: "Parsed chapters array is required." },
        });
      }

      if (chapters.length > 30) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID", message: "Maximum of 30 chapters allowed." },
        });
      }

      // Validate chapters structure — normalize missing fields for robustness
      let totalSubTopics = 0;
      for (let ci = 0; ci < chapters.length; ci++) {
        const ch = chapters[ci];
        // Normalize missing chapterTitle — parser always sets it, but OCR edge cases may lose it
        if (!ch.chapterTitle) {
          Logger.warn(
            "course-outline/generate: chapter missing chapterTitle, assigning default",
            {
              chapterIndex: ci,
              keys: Object.keys(ch),
              weekNumber: ch.weekNumber,
            },
          );
          ch.chapterTitle = ch.title || `Chapter ${ch.weekNumber || ci + 1}`;
        }
        // Accept chapters without sub-topics (bare TOC like Philosophy) — treat as standalone
        if (!Array.isArray(ch.subTopics)) {
          ch.subTopics = [];
        }
        if (ch.subTopics.length > 25) {
          return res.status(400).json({
            success: false,
            error: {
              code: "INVALID",
              message: `Chapter "${ch.chapterTitle.substring(0, 50)}" has too many sub-topics (max 25).`,
            },
          });
        }
        totalSubTopics += ch.subTopics.length;
      }
      if (totalSubTopics > 300) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID",
            message: "Total sub-topics across all chapters cannot exceed 300.",
          },
        });
      }

      // Sanitize inputs
      const safeCourseName = (courseName || "Course Notes").substring(0, 200).trim();
      const safeDepthTier = ["full", "standard", "condensed"].includes(depthTier)
        ? depthTier
        : "standard";
      const safeHash =
        contentHash ||
        crypto.createHash("sha256").update(JSON.stringify(chapters)).digest("hex");

      // Dedup check
      const existing = await SummarySession.findOne({
        userId: req.user.id,
        sourceFileHash: safeHash,
        sessionType: "course_outline",
        status: { $in: ["complete", "partial", "streaming"] },
      }).lean();

      if (existing) {
        return res.json({
          success: true,
          deduplicated: true,
          sessionId: existing._id.toString(),
          message: "An existing session for this outline was found.",
        });
      }

      // Create session with chapter skeletons
      const chapterDocs = chapters.map((ch, idx) => ({
        id: ch.weekNumber || idx + 1,
        title: ch.chapterTitle.substring(0, 500),
        hook: "",
        coreTeaching: [],
        keyTakeaways: [],
        notes: "",
        overview: "",
        subChapters: [],
      }));

      const session = await SummarySession.create({
        userId: req.user.id,
        sessionType: "course_outline",
        sourceFileName: safeCourseName,
        sourceFileHash: safeHash,
        sourceFileSize: typeof sourceFileSize === "number" ? sourceFileSize : 0,
        s3Key: null,
        courseName: safeCourseName,
        depthTier: safeDepthTier,
        title: safeCourseName,
        chapters: chapterDocs,
        status: "streaming",
        totalExpectedChunks: chapters.length,
        chatHistory: [
          {
            role: "assistant",
            content: `Hey ${user.fullname?.split(" ")[0] || "there"}, your course notes for "${safeCourseName}" are being generated. What do you need clarity on?`,
          },
        ],
      });

      // Enforce session limit
      SummarySession.enforceSessionLimit(req.user.id, 20).catch((err) => {
        Logger.warn("enforceSessionLimit error", { error: err.message });
      });

      const sessionId = session._id.toString();

      // Create in-memory job for streaming
      const jobId = _summaryJobCreate(req.user.id);
      const job = _summaryJobStore.get(jobId);
      if (job) {
        job.sessionId = sessionId;
        job.sessionType = "course_outline";
      }

      Logger.info("course-outline/generate job created", {
        jobId,
        sessionId,
        userId: req.user.id,
        chapters: chapters.length,
        depthTier: safeDepthTier,
      });

      // Return immediately
      res.json({ success: true, jobId, sessionId });

      // Background generation
      setImmediate(async () => {
        try {
          // Emit title event
          _summaryJobEmit(jobId, { type: "title", title: safeCourseName });

          await outlineGenerationService.generateOutlineContent({
            sessionId,
            chapters,
            courseName: safeCourseName,
            depthTier: safeDepthTier,
            onProgress: (event) => {
              // Map internal events to stream events
              if (event.type === "chapter_overview") {
                _summaryJobEmit(jobId, {
                  type: "chapter_overview",
                  chapterNumber: event.chapterNumber,
                  chapterTitle: event.chapterTitle,
                  overview: event.overview,
                });
              } else if (event.type === "sub_chapter") {
                _summaryJobEmit(jobId, {
                  type: "sub_chapter",
                  chapterNumber: event.chapterNumber,
                  subChapterNumber: event.subChapterNumber,
                  subChapterTitle: event.subChapterTitle,
                  success: event.success,
                  completedSubChapters: event.completedSubChapters,
                  totalSubChapters: event.totalSubChapters,
                  currentChapter: event.currentChapter,
                  totalChapters: event.totalChapters,
                });
              } else if (event.type === "chapter_complete") {
                // Reload chapter from DB and emit as a "chapter" event for backward compat
                SummarySession.findById(sessionId)
                  .lean()
                  .then((sess) => {
                    const ch = sess?.chapters?.find((c) => c.id === event.chapterNumber);
                    if (ch) {
                      _summaryJobEmit(jobId, { type: "chapter", chapter: ch });
                    }
                  })
                  .catch(() => {});
              }
            },
          });

          _summaryJobEmit(jobId, { type: "complete", totalChapters: chapters.length });
        } catch (bgErr) {
          Logger.error("course-outline/generate background error", {
            jobId,
            error: bgErr.message,
          });
          _summaryJobEmit(jobId, {
            type: "error",
            message: "Generation encountered an error. Please try again.",
          });
          try {
            await SummarySession.updateOne({ _id: sessionId }, { status: "failed" });
          } catch {}
        }
      });
    } catch (err) {
      Logger.error("course-outline/generate error", { error: err.message });
      res.status(500).json({
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: "An internal error occurred. Please try again.",
        },
      });
    }
  },
);

// ── POST /api/ai/course-outline/:sessionId/export — Generate notes PDF ──
app.post("/api/ai/course-outline/:sessionId/export", authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.sessionId)) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_ID", message: "Invalid session ID format." },
      });
    }

    const session = await SummarySession.findOne({
      _id: req.params.sessionId,
      userId: req.user.id,
      sessionType: "course_outline",
    }).lean();

    if (!session) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Course outline session not found." },
      });
    }

    if (session.status === "streaming") {
      return res.status(400).json({
        success: false,
        error: {
          code: "STILL_GENERATING",
          message: "Notes are still being generated. Please wait until generation completes.",
        },
      });
    }

    const user = await User.findById(req.user.id).lean();
    const { fontSize, fontFamily } = req.body || {};
    const safeFontSize = Math.min(Math.max(Number(fontSize) || 11, 8), 24);
    const allowedFonts = ["Helvetica", "Times", "Courier"];
    const safeFontFamily = allowedFonts.includes(fontFamily) ? fontFamily : "Helvetica";

    const pdfBuffer = await pdfExportService.generateNotesPDF(session, {
      userName: user?.fullname || "",
      fontSize: safeFontSize,
      fontFamily: safeFontFamily,
      watermark: true,
    });

    const safeTitle = (session.courseName || session.title || "course-notes")
      .replace(/[^a-zA-Z0-9_\-\s]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 80);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

    Logger.info("course-outline export complete", {
      sessionId: req.params.sessionId,
      userId: req.user.id,
      pdfSize: pdfBuffer.length,
    });
  } catch (err) {
    Logger.error("course-outline export error", { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "An internal error occurred. Please try again.",
      },
    });
  }
});

// ── POST /api/ai/summary/:sessionId/export — Generate summary PDF ──
app.post("/api/ai/summary/:sessionId/export", authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.sessionId)) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_ID", message: "Invalid session ID format." },
      });
    }

    const session = await SummarySession.findOne({
      _id: req.params.sessionId,
      userId: req.user.id,
      sessionType: "file_summary",
    }).lean();

    if (!session) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Summary session not found." },
      });
    }

    if (session.status === "streaming") {
      return res.status(400).json({
        success: false,
        error: {
          code: "STILL_GENERATING",
          message: "Summary is still being generated. Please wait until generation completes.",
        },
      });
    }

    const user = await User.findById(req.user.id).lean();
    const { fontSize, fontFamily } = req.body || {};
    const safeFontSize = Math.min(Math.max(Number(fontSize) || 13, 8), 24);
    const allowedFonts = ["Helvetica", "Times", "Courier"];
    const safeFontFamily = allowedFonts.includes(fontFamily) ? fontFamily : "Helvetica";

    // ── Extract images from original source file for PDF embedding ──
    let sourceImages = [];
    const srcName = (session.sourceFileName || "").toLowerCase();
    const isPptx = srcName.endsWith(".pptx") || srcName.endsWith(".ppt");
    const isPdf = srcName.endsWith(".pdf");
    const isDocx = srcName.endsWith(".docx");
    const isImage = /\.(jpe?g|png|webp|gif)$/.test(srcName);

    if (session.s3Key && (isPptx || isPdf || isDocx || isImage)) {
      try {
        const fileBuffer = await _downloadSummaryFileFromStorage(session.s3Key);

        if (isPptx) {
          const pptxResult = await parsePptx(fileBuffer, { includeImageBuffers: true });
          const slideImages = (pptxResult.slides || []).flatMap((s) =>
            (s.images || []).map((img) => ({
              ...img,
              slideNumber: s.slideNumber,
              position: s.slideNumber,
              totalPositions: (pptxResult.slides || []).length,
              sourceFormat: "pptx",
            })),
          );
          const allImages = (pptxResult.images || [])
            .filter((img) => img.buffer)
            .map((img) => ({
              ...img,
              sourceFormat: "pptx",
            }));
          sourceImages = slideImages.length > 0 ? slideImages : allImages;
        } else if (isPdf) {
          const { renderPagesForEmbedding } = require("./services/pdfPageRenderer");
          const pageRenders = await renderPagesForEmbedding(fileBuffer);
          const totalPages =
            pageRenders.length > 0 ? Math.max(...pageRenders.map((p) => p.pageNum)) : 1;
          sourceImages = pageRenders
            .filter((p) => p.pngBuffer.length >= 2048)
            .map((p) => ({
              buffer: p.pngBuffer,
              name: `page-${p.pageNum}.png`,
              type: "png",
              position: p.pageNum,
              totalPositions: totalPages,
              sourceFormat: "pdf",
            }));
        } else if (isDocx) {
          const { extractDocxImages } = require("./parsers/docxParser");
          const { images: docxImgs } = extractDocxImages(fileBuffer, { includeBuffers: true });
          sourceImages = docxImgs
            .filter((img) => img.buffer && img.size >= 2048)
            .map((img) => ({
              buffer: img.buffer,
              name: img.name,
              type: img.type,
              position: img.paragraphIndex,
              totalPositions: img.totalParagraphs,
              sourceFormat: "docx",
            }));
        } else if (isImage) {
          sourceImages = [
            {
              buffer: fileBuffer,
              name: session.sourceFileName,
              type: srcName.match(/\.([^.]+)$/)?.[1] || "png",
              position: 1,
              totalPositions: 1,
              sourceFormat: "image",
            },
          ];
        }

        // ── Distribute images to chapters using stored imageRefs ──
        // Each chapter has imageRefs[] with { name, position, sourceFormat }
        // Match re-extracted images to chapters using position + sourceFormat
        const chapters = session.chapters || [];
        const hasImageRefs = chapters.some((ch) => ch.imageRefs && ch.imageRefs.length > 0);

        if (hasImageRefs && sourceImages.length > 0) {
          // Build a lookup: "sourceFormat:position:name" → image with buffer
          const imgLookup = new Map();
          for (const img of sourceImages) {
            // Primary key: format + position + name
            const key1 = `${img.sourceFormat}:${img.position}:${img.name}`;
            if (!imgLookup.has(key1)) imgLookup.set(key1, img);
            // Secondary key: format + position (for PDF pages where name is generated)
            const key2 = `${img.sourceFormat}:${img.position}`;
            if (!imgLookup.has(key2)) imgLookup.set(key2, img);
          }

          // Replace sourceImages with positionally-matched per-chapter arrays
          const mappedImages = [];
          for (const ch of chapters) {
            for (const ref of ch.imageRefs || []) {
              const key1 = `${ref.sourceFormat}:${ref.position}:${ref.name}`;
              const key2 = `${ref.sourceFormat}:${ref.position}`;
              const matched = imgLookup.get(key1) || imgLookup.get(key2);
              if (matched) {
                mappedImages.push({
                  ...matched,
                  chapterId: ch.id, // Tag with chapter for direct mapping
                });
              }
            }
          }
          if (mappedImages.length > 0) sourceImages = mappedImages;
        }

        Logger.info("summary export: source images extracted", {
          format: isPptx ? "pptx" : isPdf ? "pdf" : isDocx ? "docx" : "image",
          imageCount: sourceImages.length,
          sessionId: req.params.sessionId,
        });
      } catch (imgErr) {
        Logger.warn("summary export: failed to extract source images, continuing without", {
          error: imgErr.message,
        });
      }
    }

    const pdfBuffer = await pdfExportService.generateSummaryPDF(session, {
      userName: user?.fullname || "",
      fontSize: safeFontSize || 13,
      fontFamily: safeFontFamily,
      watermark: true,
      sourceImages,
    });

    const safeTitle = (session.title || "study-summary")
      .replace(/[^a-zA-Z0-9_\-\s]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 80);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);

    Logger.info("summary export complete", {
      sessionId: req.params.sessionId,
      userId: req.user.id,
      pdfSize: pdfBuffer.length,
    });
  } catch (err) {
    Logger.error("summary export error", { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "An internal error occurred. Please try again.",
      },
    });
  }
});

// ── POST /api/ai/course-outline/:sessionId/retry — Retry only failed sub-chapters ──
app.post(
  "/api/ai/course-outline/:sessionId/retry",
  authenticateToken,
  checkTokenLimit(1500),
  trackTokenUsage,
  async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.sessionId)) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_ID", message: "Invalid session ID format." },
        });
      }

      const session = await SummarySession.findOne({
        _id: req.params.sessionId,
        userId: req.user.id,
        sessionType: "course_outline",
      });

      if (!session) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Course outline session not found." },
        });
      }

      if (session.status === "streaming") {
        return res.status(400).json({
          success: false,
          error: {
            code: "STILL_GENERATING",
            message: "Generation is still in progress. Please wait.",
          },
        });
      }

      // Check if there are any failed sub-chapters to retry
      const hasFailures = session.chapters.some((ch) =>
        ch.subChapters?.some((sc) => sc.status === "failed"),
      );
      if (!hasFailures) {
        return res.status(400).json({
          success: false,
          error: { code: "NO_FAILURES", message: "No failed sub-chapters to retry." },
        });
      }

      // Set status back to streaming
      session.status = "streaming";
      await session.save();

      // Create a streaming job
      const jobId = _summaryJobCreate(req.user.id);

      Logger.info("course-outline/retry started", {
        jobId,
        sessionId: req.params.sessionId,
        userId: req.user.id,
      });

      res.json({ success: true, jobId, sessionId: req.params.sessionId });

      // Background retry
      setImmediate(async () => {
        try {
          const result = await outlineGenerationService.retryFailedSubChapters({
            sessionId: req.params.sessionId,
            onProgress: (event) => {
              if (event.type === "sub_chapter_retry") {
                _summaryJobEmit(jobId, {
                  type: "sub_chapter",
                  chapterNumber: event.chapterNumber,
                  subChapterNumber: event.subChapterNumber,
                  subChapterTitle: event.subChapterTitle,
                  success: event.success,
                });
              }
            },
          });

          // Reload full session and emit each chapter for the frontend to refresh
          const updated = await SummarySession.findById(req.params.sessionId).lean();
          if (updated) {
            for (const ch of updated.chapters) {
              _summaryJobEmit(jobId, { type: "chapter", chapter: ch });
            }
          }

          _summaryJobEmit(jobId, { type: "complete", retryResult: result });
        } catch (bgErr) {
          Logger.error("course-outline/retry background error", {
            jobId,
            error: bgErr.message,
          });
          _summaryJobEmit(jobId, {
            type: "error",
            message: "Retry encountered an error. Please try again.",
          });
          try {
            await SummarySession.updateOne(
              { _id: req.params.sessionId },
              { status: "partial" },
            );
          } catch {}
        }
      });
    } catch (err) {
      Logger.error("course-outline/retry error", { error: err.message });
      res.status(500).json({
        success: false,
        error: {
          code: "SERVER_ERROR",
          message: "An internal error occurred. Please try again.",
        },
      });
    }
  },
);

// ══ POST /api/ai/summary-sessions/:id/generate-quiz — generate quiz from the saved source file ──
app.post(
  "/api/ai/summary-sessions/:id/generate-quiz",
  authenticateToken,
  checkTokenLimit(1000),
  trackTokenUsage,
  async (req, res) => {
    try {
      const session = await SummarySession.findOne({
        _id: req.params.id,
        userId: req.user.id,
      }).lean();
      if (!session)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Session not found" },
        });
      if (!session.s3Key) {
        return res.status(400).json({
          success: false,
          error: {
            code: "NO_FILE",
            message: "Original source file not available for quiz generation.",
          },
        });
      }

      const { numberOfQuestions = 10, difficulty = "medium" } = req.body;
      const questionsCount = Math.min(Math.max(parseInt(numberOfQuestions) || 10, 5), 200);
      const topic = session.title || session.sourceFileName.replace(/\.[^.]+$/, "");

      // Fetch file from S3
      let fileBuffer;
      try {
        fileBuffer = await _downloadSummaryFileFromStorage(session.s3Key);
      } catch (s3Err) {
        Logger.error("generate-quiz-from-summary: Storage download failed", {
          error: s3Err.message,
        });
        return res.status(500).json({
          success: false,
          error: { code: "STORAGE_ERROR", message: "Could not retrieve original file." },
        });
      }

      // Determine file extension and build a mock file object for the existing pipeline
      const ext = (session.sourceFileName.match(/\.[^.]+$/) || [".txt"])[0].toLowerCase();
      const mockFile = {
        name: session.sourceFileName,
        data: fileBuffer,
        mimetype:
          ext === ".pdf"
            ? "application/pdf"
            : ext === ".docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : "text/plain",
        size: fileBuffer.length,
      };

      // Use the batch generation service (same pipeline as generate-from-notes)
      const batchGenerationService = require("./services/batchGenerationService");
      const batchProcessingService = require("./services/batchProcessingService");

      // Extract text content
      let extractedContent = "";
      if (ext === ".pdf") {
        extractedContent = await require("./parsers").parsePdf(fileBuffer);
      } else if (ext === ".docx") {
        extractedContent = await require("./parsers").parseDocx(fileBuffer);
      } else if (ext === ".pptx" || ext === ".ppt") {
        extractedContent = await batchProcessingService.extractFullContent(fileBuffer, ext);
      } else {
        extractedContent = fileBuffer.toString("utf8");
      }

      if (!extractedContent || extractedContent.trim().length < 50) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INSUFFICIENT_CONTENT",
            message: "Not enough content in the source file to generate questions.",
          },
        });
      }

      // Compute question type split
      const split = _computeQuestionTypeSplit(questionsCount);

      // Generate questions with type awareness
      const questions = await aiService.generateMixedQuestions({
        text: extractedContent,
        count: questionsCount,
        difficulty,
        topic,
        split,
      });

      if (!questions || questions.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "NO_QUESTIONS",
            message: "Could not generate questions from this content.",
          },
        });
      }

      // Save questions to DB
      const savedQuestions = await Question.insertMany(
        questions.map((q) => ({
          ...q,
          userId: req.user.id,
          topic: topic.toLowerCase(),
          sourceFile: session.sourceFileName,
        })),
      );

      res.json({
        success: true,
        topic: topic.toLowerCase(),
        questionsCount: savedQuestions.length,
        split,
        questions: savedQuestions,
      });
    } catch (err) {
      Logger.error("generate-quiz-from-summary error", { error: err.message });
      res
        .status(500)
        .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
    }
  },
);

// ── POST /api/ai/summary-sessions/:id/quick-check — 5 quick comprehension questions ──
app.post(
  "/api/ai/summary-sessions/:id/quick-check",
  authenticateToken,
  checkTokenLimit(500),
  trackTokenUsage,
  async (req, res) => {
    try {
      const session = await SummarySession.findOne({
        _id: req.params.id,
        userId: req.user.id,
      }).lean();
      if (!session)
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Session not found" },
        });
      if (!session.chapters || session.chapters.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "NO_CONTENT",
            message: "No chapters available for comprehension check.",
          },
        });
      }

      // Build a text excerpt from all chapters
      const chapterText = session.chapters
        .map((ch) => {
          const teaching = (ch.coreTeaching || [])
            .map((s) => `${s.sectionTitle}: ${s.content}`)
            .join("\n");
          const takeaways = (ch.keyTakeaways || []).join(". ");
          return `${ch.title}\n${teaching}\n${takeaways}`;
        })
        .join("\n\n")
        .slice(0, 12000);

      const { chapterIdx } = req.body; // optional: scope to specific chapter
      let scopedText = chapterText;
      if (typeof chapterIdx === "number" && session.chapters[chapterIdx]) {
        const ch = session.chapters[chapterIdx];
        const teaching = (ch.coreTeaching || [])
          .map((s) => `${s.sectionTitle}: ${s.content}`)
          .join("\n");
        scopedText = `${ch.title}\n${teaching}\n${(ch.keyTakeaways || []).join(". ")}`;
      }

      const split = _computeQuestionTypeSplit(5);

      const questions = await aiService.generateMixedQuestions({
        text: scopedText,
        count: 5,
        difficulty: "medium",
        topic: session.title || "Comprehension Check",
        split,
      });

      res.json({
        success: true,
        questions: questions || [],
        split,
      });
    } catch (err) {
      Logger.error("quick-check error", { error: err.message });
      res
        .status(500)
        .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
    }
  },
);

// ─── GET /api/ai/summary-sessions/:id/threads ───────────────────────────────
app.get("/api/ai/summary-sessions/:id/threads", authenticateToken, async (req, res) => {
  try {
    const session = await SummarySession.findOne({
      _id: req.params.id,
      userId: req.user.id,
    }).lean();
    if (!session)
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Session not found" } });
    const threads = await ChatThread.listForSession(req.params.id, req.user.id);
    res.json({
      success: true,
      threads,
      activeChatThreadId: session.activeChatThreadId || null,
    });
  } catch (err) {
    Logger.error("chat-threads list error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
  }
});

// ─── POST /api/ai/summary-sessions/:id/threads ─────────────────────────────
app.post("/api/ai/summary-sessions/:id/threads", authenticateToken, async (req, res) => {
  try {
    const session = await SummarySession.findOne({
      _id: req.params.id,
      userId: req.user.id,
    }).lean();
    if (!session)
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Session not found" } });

    // Soft cap: warn at 20 threads per session
    const threadCount = await ChatThread.countDocuments({
      sessionId: req.params.id,
      userId: req.user.id,
    });
    if (threadCount >= 20) {
      return res.status(400).json({
        success: false,
        error: {
          code: "THREAD_LIMIT",
          message:
            "You've reached the 20-chat limit for this session. Delete an old chat to create a new one.",
        },
      });
    }

    const thread = await ChatThread.create({
      sessionId: req.params.id,
      userId: req.user.id,
      title: (req.body.title || "New Chat").slice(0, 100),
    });

    // Set as active thread
    await SummarySession.updateOne({ _id: req.params.id }, { activeChatThreadId: thread._id });

    res.status(201).json({ success: true, thread });
  } catch (err) {
    Logger.error("chat-thread create error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
  }
});

// ─── GET /api/ai/summary-sessions/:id/threads/:tid ─────────────────────────
app.get("/api/ai/summary-sessions/:id/threads/:tid", authenticateToken, async (req, res) => {
  try {
    const thread = await ChatThread.findOne({
      _id: req.params.tid,
      sessionId: req.params.id,
      userId: req.user.id,
    }).lean();
    if (!thread)
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Thread not found" } });
    res.json({ success: true, thread });
  } catch (err) {
    Logger.error("chat-thread load error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
  }
});

// ─── PUT /api/ai/summary-sessions/:id/threads/:tid/messages ─────────────────
// Append messages. Also auto-sets title from the first user message if title is still 'New Chat'.
app.put(
  "/api/ai/summary-sessions/:id/threads/:tid/messages",
  authenticateToken,
  async (req, res) => {
    try {
      const { messages } = req.body;
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID", message: "messages array required" },
        });
      }
      const toAdd = messages.map((m) => ({
        role: m.role,
        content: (m.content || "").slice(0, 20000),
        timestamp: new Date(),
      }));

      const thread = await ChatThread.findOne({
        _id: req.params.tid,
        sessionId: req.params.id,
        userId: req.user.id,
      });
      if (!thread)
        return res
          .status(404)
          .json({ success: false, error: { code: "NOT_FOUND", message: "Thread not found" } });

      // Auto-title from first user message — use AI to generate a short memorable title
      let titleUpdate = {};
      if (thread.title === "New Chat") {
        const firstUser =
          toAdd.find((m) => m.role === "user") ||
          thread.messages.find((m) => m.role === "user");
        if (firstUser) {
          // Fire AI title generation in the background so it doesn't block the response
          aiService
            .generateShortTitle(
              firstUser.content,
              firstUser.content.replace(/\s+/g, " ").trim().slice(0, 45),
            )
            .then((aiTitle) => {
              ChatThread.updateOne(
                { _id: req.params.tid },
                { $set: { title: aiTitle } },
              ).catch(() => {});
            })
            .catch(() => {});
          // Optimistic placeholder so the client gets something immediately
          titleUpdate = { title: firstUser.content.replace(/\s+/g, " ").trim().slice(0, 45) };
        }
      }

      // Rolling window: trim oldest messages if over limit
      const combined = [...thread.messages, ...toAdd];
      const trimmed =
        combined.length > thread.maxMessages
          ? combined.slice(combined.length - thread.maxMessages)
          : combined;

      await ChatThread.updateOne(
        { _id: req.params.tid },
        { $set: { messages: trimmed, ...titleUpdate } },
      );

      res.json({ success: true, title: titleUpdate.title || thread.title });
    } catch (err) {
      Logger.error("chat-thread messages save error", { error: err.message });
      res
        .status(500)
        .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
    }
  },
);

// ─── PATCH /api/ai/summary-sessions/:id/threads/:tid ───────────────────────
app.patch("/api/ai/summary-sessions/:id/threads/:tid", authenticateToken, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || typeof title !== "string") {
      return res
        .status(400)
        .json({ success: false, error: { code: "INVALID", message: "title required" } });
    }
    const result = await ChatThread.updateOne(
      { _id: req.params.tid, sessionId: req.params.id, userId: req.user.id },
      { title: title.trim().slice(0, 100) },
    );
    if (!result.matchedCount)
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Thread not found" } });
    res.json({ success: true });
  } catch (err) {
    Logger.error("chat-thread rename error", { error: err.message });
    res
      .status(500)
      .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
  }
});

// ─── DELETE /api/ai/summary-sessions/:id/threads/:tid ──────────────────────
app.delete(
  "/api/ai/summary-sessions/:id/threads/:tid",
  authenticateToken,
  async (req, res) => {
    try {
      const result = await ChatThread.deleteOne({
        _id: req.params.tid,
        sessionId: req.params.id,
        userId: req.user.id,
      });
      if (!result.deletedCount)
        return res
          .status(404)
          .json({ success: false, error: { code: "NOT_FOUND", message: "Thread not found" } });
      // If this was the active thread, clear activeChatThreadId
      await SummarySession.updateOne(
        { _id: req.params.id, activeChatThreadId: req.params.tid },
        { $set: { activeChatThreadId: null } },
      );
      res.json({ success: true });
    } catch (err) {
      Logger.error("chat-thread delete error", { error: err.message });
      res
        .status(500)
        .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
    }
  },
);

// ─── PATCH /api/ai/summary-sessions/:id/active-thread ──────────────────────
app.patch(
  "/api/ai/summary-sessions/:id/active-thread",
  authenticateToken,
  async (req, res) => {
    try {
      const { threadId } = req.body;
      await SummarySession.updateOne(
        { _id: req.params.id, userId: req.user.id },
        { $set: { activeChatThreadId: threadId || null } },
      );
      res.json({ success: true });
    } catch (err) {
      Logger.error("set-active-thread error", { error: err.message });
      res
        .status(500)
        .json({ success: false, error: { code: "SERVER_ERROR", message: err.message } });
    }
  },
);

// ── Helper: compute question type split (MCQ 60% / Fill-in-Gap 25% / Theory 15%) ──
function _computeQuestionTypeSplit(total) {
  if (total < 5) return { mcq: total, fillInGap: 0, theory: 0 };
  if (total < 10) {
    const fillInGap = Math.round(total * 0.25);
    return { mcq: total - fillInGap, fillInGap, theory: 0 };
  }
  const mcq = Math.round(total * 0.6);
  const fillInGap = Math.round(total * 0.25);
  const theory = total - mcq - fillInGap; // remainder ensures exact total
  return { mcq, fillInGap, theory };
}

app.post("/api/restore-from-backup", authenticateToken, async (req, res) => {
  try {
    const { topic } = req.body;
    const userId = req.user.id;

    // ===== VALIDATION #1: Topic Required =====
    if (!topic) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_TOPIC",
          message: "Topic is required",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== VALIDATION #2: Topic Type Check (NoSQL Injection Protection) =====
    if (typeof topic !== "string") {
      Logger.error("Non-string topic in restore backup", {
        userId,
        topicType: typeof topic,
        topic: JSON.stringify(topic),
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOPIC_TYPE",
          message: "Topic must be a string",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== VALIDATION #3: Advanced Topic Validation =====
    const { validateTopic } = require("./middleware/inputValidator");
    const topicError = validateTopic(topic);
    if (topicError) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOPIC",
          message: topicError,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== VALIDATION #4: Sanitize Topic (Belt and Suspenders) =====
    const { sanitize } = require("./middleware/sanitizer");

    // Check for NoSQL operators
    if (sanitize.containsOperators({ topic })) {
      Logger.error("NoSQL operator detected in topic", {
        userId,
        topic,
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_CHARACTERS",
          message: "Topic contains invalid characters",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Sanitize the topic string
    const sanitizedTopic = sanitize.string(topic, false, "topic").toLowerCase(); // Lowercase to match schema

    // ===== VALIDATION #5: Path Traversal Protection =====
    if (
      sanitizedTopic.includes("..") ||
      sanitizedTopic.includes("/") ||
      sanitizedTopic.includes("\\")
    ) {
      Logger.error("Path traversal attempt in restore backup", {
        userId,
        topic: sanitizedTopic,
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOPIC_PATH",
          message: "Topic contains invalid path characters",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== VALIDATION #6: User ID Validation =====
    const userObjectId = ensureObjectId(userId);
    if (!userObjectId) {
      Logger.error("Invalid user ID in restore backup", { userId });
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_USER_ID",
          message: "Invalid user ID format",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== STORAGE OPERATION: List Backups =====
    const s3Prefix = `question_backups/${userId}/${sanitizedTopic}`;

    Logger.info("Restore backup: Listing storage objects", {
      userId,
      topic: sanitizedTopic,
      prefix: s3Prefix,
    });

    let listed;
    try {
      listed = await storageService.list(s3Prefix, req.user.organizationId || null, {
        limit: 100,
      });
    } catch (s3Err) {
      Logger.error("Storage list operation failed", {
        userId,
        topic: sanitizedTopic,
        error: s3Err.message,
      });
      return res.status(500).json({
        success: false,
        error: {
          code: "STORAGE_LIST_ERROR",
          message: "Failed to access backup storage",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== VALIDATION #7: Backup Exists =====
    if (!listed || listed.length === 0) {
      Logger.warn("No backups found for topic", {
        userId,
        topic: sanitizedTopic,
      });
      return res.status(404).json({
        success: false,
        error: {
          code: "BACKUP_NOT_FOUND",
          message: `No backups found for topic "${sanitizedTopic}"`,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== SELECT LATEST BACKUP =====
    const latest = listed.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

    Logger.info("Latest backup selected", {
      userId,
      topic: sanitizedTopic,
      backupName: latest.name,
    });

    // ===== STORAGE OPERATION: Get Backup =====
    let data;
    try {
      const backupPath = `${s3Prefix}/${latest.name}`;
      const { buffer: backupBuffer } = await storageService.download(
        backupPath,
        req.user.organizationId || null,
      );
      data = { Body: backupBuffer };
    } catch (s3GetErr) {
      Logger.error("Storage get operation failed", {
        userId,
        backupName: latest.name,
        error: s3GetErr.message,
      });
      return res.status(500).json({
        success: false,
        error: {
          code: "S3_GET_ERROR",
          message: "Failed to retrieve backup",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== PARSE BACKUP JSON =====
    let backup;
    try {
      const bodyString = await data.Body.transformToString();
      backup = JSON.parse(bodyString);
    } catch (parseErr) {
      Logger.error("Backup JSON parse failed", {
        userId,
        backupKey: latest.Key,
        error: parseErr.message,
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "BACKUP_PARSE_ERROR",
          message: "Backup file is corrupted or invalid",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== VALIDATION #8: Backup Structure =====
    if (!Array.isArray(backup) || backup.length === 0) {
      Logger.warn("Empty or invalid backup", {
        userId,
        backupKey: latest.Key,
        isArray: Array.isArray(backup),
        length: backup?.length,
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "BACKUP_EMPTY",
          message: "Backup is empty or invalid",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== SANITIZE & VALIDATE BACKUP DATA =====
    const validatedQuestions = backup
      .map((q, index) => ({
        userId: userObjectId,
        topic: sanitizedTopic, // Use sanitized topic
        qnum: q.qnum || q.questionNumber || index + 1,
        questionText: (q.questionText || "").trim(),
        options: Array.isArray(q.options)
          ? q.options.map((o) => String(o).trim()).filter((o) => o.length > 0)
          : [],
        correctAnswer: typeof q.correctAnswer === "number" ? q.correctAnswer : null,
        explanation: (q.explanation || "").trim(),
        questionType: q.questionType || "multiple-choice",
        difficulty: q.difficulty || "Medium",
        sourceFile: q.sourceFile || `Restored_${sanitizedTopic}.json`,
        createdAt: new Date(),
      }))
      .filter((q) => {
        // Validate question text
        if (!Validators.questionText(q.questionText)) {
          Logger.warn("Invalid question text in backup", {
            qnum: q.qnum,
            length: q.questionText.length,
          });
          return false;
        }

        // Validate options for multiple choice
        if (q.questionType === "multiple-choice" && q.options.length < 2) {
          Logger.warn("Insufficient options in backup", {
            qnum: q.qnum,
            optionsCount: q.options.length,
          });
          return false;
        }

        // Validate correctAnswer index
        if (q.correctAnswer !== null) {
          if (q.correctAnswer < 0 || q.correctAnswer >= q.options.length) {
            Logger.warn("Invalid correctAnswer in backup", {
              qnum: q.qnum,
              correctAnswer: q.correctAnswer,
              optionsLength: q.options.length,
            });
            q.correctAnswer = null; // Reset to null but keep question
          }
        }

        return true;
      });

    if (validatedQuestions.length === 0) {
      Logger.warn("No valid questions after validation", {
        userId,
        backupKey: latest.Key,
        originalCount: backup.length,
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "NO_VALID_QUESTIONS",
          message: "No valid questions found in backup",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== DATABASE OPERATIONS =====

    // Delete existing questions for this topic (case-insensitive with proper escaping)
    const escapedTopicRestore = escapeRegex(sanitizedTopic);
    const deleteResult = await Question.deleteMany({
      userId: userObjectId,
      topic: new RegExp(`^${escapedTopicRestore}$`, "i"),
    });

    Logger.info("Existing questions deleted", {
      userId: userId,
      topic: sanitizedTopic,
      deletedCount: deleteResult.deletedCount,
    });

    // Insert restored questions
    let insertedQuestions;
    try {
      insertedQuestions = await Question.insertMany(validatedQuestions);
    } catch (insertErr) {
      Logger.error("Question insert failed during restore", {
        userId,
        error: insertErr.message,
      });
      return res.status(500).json({
        success: false,
        error: {
          code: "DATABASE_INSERT_ERROR",
          message: "Failed to restore questions to database",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // ===== GENERATE SIGNED URL =====
    let backupSignedUrl = null;
    try {
      backupSignedUrl = await getSignedStorageUrl(latest.Key, null, 3600);
    } catch (urlErr) {
      Logger.warn("Failed to generate signed URL", {
        error: urlErr.message,
      });
      // Non-critical, continue
    }
    try {
      await PdfLibrary.create({
        userId: userObjectId,
        fileName: `Restored_${sanitizedTopic}.json`,
        topic: sanitizedTopic,
        s3FileKey: latest.Key,
        s3BackupKey: latest.Key,
        numberOfQuestions: validatedQuestions.length,
        hasAnswers: validatedQuestions.some((q) => q.correctAnswer !== null),
        uploadedAt: new Date(),
      });
    } catch (libraryErr) {
      Logger.warn("Failed to update PDF library (non-critical)", {
        error: libraryErr.message,
      });
      // Non-critical, continue
    }

    // ===== SUCCESS RESPONSE =====
    Logger.info("Backup restored successfully", {
      userId,
      topic: sanitizedTopic,
      questionsRestored: validatedQuestions.length,
      backupKey: latest.Key,
    });

    res.json({
      success: true,
      data: {
        restored: validatedQuestions.length,
        topic: sanitizedTopic,
        backupKey: latest.Key,
        backupDate: latest.LastModified,
        backupSignedUrl,
        message: `Successfully restored ${validatedQuestions.length} questions for "${sanitizedTopic}"`,
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Logger.error("Restore backup error", {
      userId: req.user?.id,
      topic: req.body?.topic,
      error: err.message,
      stack: err.stack,
    });

    res.status(500).json({
      success: false,
      error: {
        code: "RESTORE_ERROR",
        message: "Failed to restore from backup. Please try again later",
        details: process.env.NODE_ENV === "development" ? err.message : undefined,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

app.post("/api/admin/retry-upload", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { topic, fileName, questions, fileBuffer, mimeType } = req.body;

    if (!topic || !Validators.topic(topic)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOPIC",
          message: "Invalid topic format",
          timestamp: new Date().toISOString(),
        },
      });
    }
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: "NO_QUESTIONS",
          message: "No questions provided for upload",
          timestamp: new Date().toISOString(),
        },
      });
    }
    const userId = new mongoose.Types.ObjectId(req.user.id);
    Logger.info("Retry upload started", {
      userId: userId.toString(),
      topic,
      questionCount: questions.length,
    });

    const cleanedQuestions = questions
      .map((q) => ({
        userId,
        topic,
        questionNumber: q.questionNumber || q.qnum || "1",
        subPart: q.subPart || null,
        questionText: q.questionText || "",
        questionType: q.questionType || "multiple-choice",
        options: Array.isArray(q.options) ? q.options : [],
        correctAnswer: typeof q.correctAnswer === "number" ? q.correctAnswer : null,
        explanation: q.explanation || "",
        difficulty: q.difficulty || "Medium",
        sourceFile: fileName || "offline_upload.json",
        createdAt: new Date(),
      }))
      .filter((q) => {
        if (!Validators.questionText(q.questionText)) {
          return false;
        }
        if (q.questionType === "multiple-choice" && q.options.length < 2) {
          return false;
        }
        if (typeof q.correctAnswer === "number") {
          if (q.correctAnswer < 0 || q.correctAnswer >= q.options.length) {
            q.correctAnswer = null;
          }
        }
        return true;
      });

    if (cleanedQuestions.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: "NO_VALID_QUESTIONS",
          message: "No valid questions after validation",
          timestamp: new Date().toISOString(),
        },
      });
    }

    await Question.insertMany(cleanedQuestions);

    let s3FileKey = null;
    let s3Url = null;
    if (fileBuffer && mimeType) {
      try {
        const buffer = Buffer.from(fileBuffer, "base64");
        const s3Upload = await uploadToStorage(
          buffer,
          fileName,
          mimeType,
          req.user.id,
          req.user.organizationId || null,
        );
        s3FileKey = s3Upload.Key;
        s3Url = s3Upload.url;
        Logger.info("Storage upload successful during retry", { s3FileKey });
      } catch (s3Err) {
        Logger.warn("Storage upload failed during retry", { error: s3Err.message });
      }
    }
    let backupInfo = null;
    try {
      backupInfo = await saveBackupToStorage(
        req.user.id,
        topic,
        cleanedQuestions,
        req.user.organizationId || null,
      );
      Logger.info("Backup created during retry", { backupKey: backupInfo.backupKey });
    } catch (backupErr) {
      Logger.warn("Backup failed during retry", { error: backupErr.message });
    }

    await PdfLibrary.create({
      userId,
      fileName: fileName || "offline_upload.json",
      topic,
      numberOfQuestions: cleanedQuestions.length,
      hasAnswers: cleanedQuestions.some((q) => q.correctAnswer !== null),
      s3FileKey,
      s3BackupKey: backupInfo?.backupKey || null,
      uploadedAt: new Date(),
    });

    Logger.info("Retry upload successful", {
      userId: userId.toString(),
      questionAdded: cleanedQuestions.length,
    });

    res.json({
      success: true,
      data: {
        questionAdded: cleanedQuestions.length,
        topic,
        message: `Successfully uploaded ${cleanedQuestions.length} questions from offline storage.`,
        s3Url,
        backupUrl: backupInfo?.backupUrl || null,
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Logger.error("Retry upload error", {
      error: err.message,
      userId: req.user?.id,
    });

    res.status(500).json({
      success: false,
      error: {
        code: "RETRY_UPLOAD_ERROR",
        message: "Failed to process offline upload",
        timestamp: new Date().toISOString(),
      },
    });
  }
});

app.get("/api/health", (req, res) => {
  const dbStatus = getStatus();
  const { isRedisReady } = require("./redisClient");
  const redisReady = isRedisReady();
  const isHealthy = dbStatus.connected;

  res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    status: isHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    services: {
      database: {
        connected: dbStatus.connected,
        state: dbStatus.state,
        reconnectAttempts: dbStatus.reconnectAttempts,
      },
      redis: {
        connected: redisReady,
        status: redisReady ? "ready" : "unavailable",
      },
      server: {
        uptime: Math.floor(process.uptime()),
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB",
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + " MB",
        },
      },
    },
  });
});

app.get("/api/admin/pending-uploads", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.user.id;

    const uploadsWithoutBackup = await PdfLibrary.find({
      userId: new mongoose.Types.ObjectId(userId),
      $or: [{ s3BackupKey: null }, { s3FileKey: null }],
    }).sort({ uploadedAt: -1 });

    res.json({
      success: true,
      data: {
        count: uploadsWithoutBackup.length,
        uploads: uploadsWithoutBackup,
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Logger.error("Get pending uploads error", { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: "FETCH_ERROR",
        message: "Failed to fetch pending uploads",
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// ===== MAIN ENDPOINT =====
app.post(
  "/api/ai/parse-questions",
  authenticateToken,
  checkUploadLimit,
  checkFileSize,
  checkStorageLimit,
  checkTokenLimit(1500),
  validateFileUpload,
  trackUpload,
  trackTokenUsage,
  async (req, res) => {
    const startTime = Date.now();

    try {
      const { topic } = req.body;

      // ===== VALIDATION =====
      if (!topic || !Validators.topic(topic)) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_TOPIC",
            message: "Valid topic is required (3-50 alphanumeric characters)",
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (!req.validatedFile) {
        return res.status(400).json({
          success: false,
          error: {
            code: "NO_FILE",
            message: "No file uploaded",
            timestamp: new Date().toISOString(),
          },
        });
      }

      const file = req.validatedFile;
      const fileName = file.sanitizedName;
      const fileBuffer = file.data;
      const ext = file.extension;
      const mimeType = file.mimeType;

      // ===== FILE TYPE VALIDATION =====
      if (!/\.(png|jpg|jpeg|webp|gif|tif|tiff)$/i.test(ext)) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_FILE_TYPE",
            message: "Only image files are supported (PNG, JPG, JPEG, WEBP, GIF, TIFF)",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // File size check (20MB max for multi-page support)
      if (fileBuffer.length > 20 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          error: {
            code: "FILE_TOO_LARGE",
            message: "Image must be less than 20MB",
            timestamp: new Date().toISOString(),
          },
        });
      }

      const userId = new mongoose.Types.ObjectId(req.user.id);

      // ===== DETECT MULTI-PAGE =====
      const isMultiPage = await aiService.isMultiPageImage(fileBuffer, fileName);

      // ===== SPLIT IMAGE IF NEEDED =====
      let imagePages;
      try {
        imagePages = await aiService.splitImageIntoPages(fileBuffer, fileName);
      } catch (splitErr) {
        Logger.error("Image splitting failed", { error: splitErr.message });
        return res.status(400).json({
          success: false,
          error: {
            code: "IMAGE_PROCESSING_ERROR",
            message: "Failed to process image. Please ensure it's a valid image file.",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // ===== EXTRACT QUESTIONS FROM ALL PAGES =====
      const { questions: rawQuestions, errors } = await aiService.processImagesInBatches(
        imagePages,
        { topic, fileName },
      );

      if (rawQuestions.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "NO_QUESTIONS_FOUND",
            message:
              errors.length > 0
                ? `Failed to extract questions. ${errors.length} page(s) had errors.`
                : "No questions detected in image(s). Please ensure the image contains academic content.",
            errors: errors.length > 0 ? errors : undefined,
            timestamp: new Date().toISOString(),
          },
        });
      }

      // ===== CLEAN & VALIDATE QUESTIONS =====
      const cleanedQuestions = rawQuestions
        .map((q, index) => ({
          questionNumber: q.qnum || (index + 1).toString(),
          subPart: q.subPart || null,
          questionText: (q.questionText || "")
            .trim()
            .replace(/^(?:question|q)\s*\d+\s*[:\-\.)]\s*/i, ""),
          options: Array.isArray(q.options)
            ? [
                ...new Set(
                  q.options
                    .map((o) => o.replace(/^[A-Ha-h][\)\.\:\-\s]+/, "").trim())
                    .filter((o) => o.length > 0),
                ),
              ]
            : [],
          correctAnswer: typeof q.correctAnswer === "number" ? q.correctAnswer : null,
          explanation: (q.explanation || "").trim(),
          difficulty: q.difficulty || "Medium",
          questionType:
            q.questionType || (q.options?.length > 0 ? "multiple-choice" : "essay"),
          userId,
          topic,
          sourceFile: fileName,
        }))
        .filter((q) => {
          // Validation
          if (q.questionText.length < 10) {
            return false;
          }

          if (q.questionText.length > 2000) {
            q.questionText = q.questionText.substring(0, 2000);
          }

          // Multiple choice needs options
          if (q.questionType === "multiple-choice" && q.options.length < 2) {
            return false;
          }

          // Validate correctAnswer
          if (q.correctAnswer !== null) {
            if (q.correctAnswer < 0 || q.correctAnswer >= q.options.length) {
              q.correctAnswer = null;
            }
          }

          return true;
        });

      // ===== ADVANCED DEDUPLICATION =====
      const seen = new Set();
      const deduped = cleanedQuestions.filter((q) => {
        const key = q.questionText
          .toLowerCase()
          .replace(/[^\w\s]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 100);

        if (seen.has(key)) {
          Logger.debug("Duplicate removed", { qnum: q.questionNumber });
          return false;
        }

        seen.add(key);
        return true;
      });

      if (deduped.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "NO_VALID_QUESTIONS",
            message: "No valid questions after processing. Please check image quality.",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // B2B: org-scoped storage upload via Supabase
      const orgId = req.user.organizationId || null;
      const [s3Result, dbResult, backupResult] = await Promise.allSettled([
        uploadToStorage(fileBuffer, fileName, mimeType, req.user.id, orgId),
        Question.insertMany(deduped),
        saveBackupToStorage(req.user.id, topic, deduped, orgId),
      ]);

      // Handle S3 upload result
      let s3FileKey = null;
      let s3Url = null;
      if (s3Result.status === "fulfilled") {
        s3FileKey = s3Result.value.Key;
        s3Url = s3Result.value.url;
        Logger.info("S3 upload successful", { s3FileKey });
      } else {
        Logger.error("S3 upload failed", { error: s3Result.reason?.message });
      }

      // Handle database insert result
      if (dbResult.status === "rejected") {
        Logger.error("Database insert failed", { error: dbResult.reason?.message });
        throw new Error("Failed to save questions to database");
      }

      // Handle backup result
      let backupKey = null;
      let backupUrl = null;
      if (backupResult.status === "fulfilled") {
        backupKey = backupResult.value.backupKey;
        backupUrl = backupResult.value.backupUrl;
        Logger.info("Backup successful", { backupKey });
      } else {
        Logger.warn("Backup failed (non-critical)", { error: backupResult.reason?.message });
      }

      await PdfLibrary.create({
        userId,
        fileName,
        topic,
        numberOfQuestions: deduped.length,
        hasAnswers: deduped.some((q) => q.correctAnswer !== null),
        s3FileKey,
        s3BackupKey: backupKey,
        uploadedAt: new Date(),
      });

      const processingTime = Date.now() - startTime;

      res.json({
        success: true,
        data: {
          questionsAdded: deduped.length,
          message: `Successfully extracted ${deduped.length} questions from ${imagePages.length} page(s)`,
          processingTime: `${(processingTime / 1000).toFixed(2)}s`,
          fileName,
          topic,
          pages: imagePages.length,
          s3Url,
          backupUrl,
          errors: errors.length > 0 ? errors : undefined,
        },
        error: null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const processingTime = Date.now() - startTime;

      Logger.error("Image parse error", {
        error: err.message,
        stack: err.stack,
        time: processingTime,
      });

      res.status(500).json({
        success: false,
        error: {
          code: "PROCESSING_ERROR",
          message: "Failed to process image. Please try again with a clearer image.",
          details: process.env.NODE_ENV === "development" ? err.message : undefined,
          timestamp: new Date().toISOString(),
        },
      });
    }
  },
);

app.post(
  "/api/ai/grade-answer",
  authenticateToken,
  checkTokenLimit(500),
  trackTokenUsage,
  async (req, res) => {
    try {
      const { questionText, userAnswer, correctAnswer } = req.body;

      if (!questionText || userAnswer === undefined) {
        return sendError(res, 400, "questionText and userAnswer required", "MISSING_FIELDS");
      }

      const grade = await aiService.gradeAnswer(
        questionText,
        userAnswer,
        correctAnswer || null,
      );

      if (!grade.success) {
        return sendError(res, 500, grade.error || "Grading failed", "GRADING_ERROR");
      }

      res.json(grade);
    } catch (err) {
      Logger.error("Grade answer error:", { error: err.message });
      return sendError(res, 500, "Grading failed", "GRADING_ERROR");
    }
  },
);

app.post(
  "/api/ai/chat",
  authenticateToken,
  checkTokenLimit(1000),
  trackTokenUsage,
  async (req, res) => {
    try {
      const {
        messages,
        context = "academic",
        studyData = null,
        model: clientModel = null,
      } = req.body;

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Message array required" });
      }

      // clientModel lets specific features (e.g. summary AI tutor) pin a model;
      // falls back to the user's tier model or the service default.
      const result = await aiService.chat(
        messages,
        context,
        clientModel || req.user?.limits?.aiModel || null,
      );

      res.json({
        success: true,
        content: result.content,
        usage: {
          current: req.user.usage.aiRequestsThisMonth + 1,
          limit: req.user.limits.aiRequestsPerMonth,
        },
      });
    } catch (err) {
      Logger.error("AI Chat Error:", { error: err.message });
      return sendError(res, 500, "AI Chat Error", "AI_CHAT_ERROR");
    }
  },
);

// Get AI cache statistics
app.get("/api/ai/cache-stats", authenticateToken, async (req, res) => {
  try {
    const stats = await aiService.getCacheStats();
    res.json({
      success: true,
      stats,
    });
  } catch (err) {
    Logger.error("Cache stats error:", { error: err.message });
    return sendError(res, 500, "Failed to retrieve cache statistics", "CACHE_STATS_ERROR");
  }
});

// Clear AI cache (admin only recommended)
app.post("/api/ai/clear-cache", authenticateToken, async (req, res) => {
  try {
    const result = await aiService.clearCache();
    res.json({
      success: result.success,
      message: result.success ? "AI cache cleared successfully" : "Failed to clear cache",
      keysDeleted: result.keysDeleted || 0,
    });
  } catch (err) {
    Logger.error("Cache clear error:", { error: err.message });
    return sendError(res, 500, "Failed to clear cache", "CACHE_CLEAR_ERROR");
  }
});

app.get("/api/files/download/:fileKey", authenticateToken, async (req, res) => {
  try {
    const { fileKey } = req.params;
    const userId = req.user.id;

    const upload = await PdfLibrary.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      s3FileKey: decodeURIComponent(fileKey),
    });

    if (!upload) {
      return res.status(404).json({
        success: false,
        error: {
          code: "FILE_NOT_FOUND",
          message: "File not found or access denied",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const signedUrl = await getSignedStorageUrl(
      fileKey,
      req.user.organizationId || null,
      3600,
    );

    if (!signedUrl) {
      return res.status(500).json({
        success: false,
        error: {
          code: "URL_GENERATION_FAILED",
          message: "Failed to generate download URL",
          timestamp: new Date().toISOString(),
        },
      });
    }

    res.json({
      success: true,
      data: {
        downloadurl: signedUrl,
        fileName: upload.fileName,
        expiresIn: "1 hour",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Logger.error("File download error", { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to generate download URL",
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// SECURITY: Hard cap on file count — reject before buffering
const ABSOLUTE_MAX_FILES = 10; // Matches highest tier (Pro)

// Conditional file validation - supports both single and multi-file uploads
const conditionalFileValidation = (req, res, next) => {
  const fileCount = req.files
    ? Array.isArray(req.files.file)
      ? req.files.file.length
      : req.files.file
        ? 1
        : 0
    : 0;
  Logger.info("Conditional file validation check", {
    hasFiles: fileCount > 0,
    fileCount,
  });

  // SECURITY: Reject immediately if file count exceeds absolute hard cap
  if (fileCount > ABSOLUTE_MAX_FILES) {
    Logger.warn("File upload rejected - absolute file count cap exceeded", {
      fileCount,
      max: ABSOLUTE_MAX_FILES,
    });
    return res.status(413).json({
      success: false,
      error: {
        code: "FILE_COUNT_EXCEEDED",
        message: `Maximum ${ABSOLUTE_MAX_FILES} files per upload. You sent ${fileCount}.`,
        timestamp: new Date().toISOString(),
      },
    });
  }

  // If there are files, validate them
  if (req.files && Object.keys(req.files).length > 0) {
    if (fileCount > 1) {
      Logger.info("Running MULTI-file validation", { fileCount });
      return validateMultiFileUpload(req, res, next);
    }
    Logger.info("Running single-file validation");
    return validateFileUpload(req, res, next);
  }
  // If no file (text input), skip validation
  Logger.info("Skipping file validation - no file present");
  next();
};

app.post(
  "/api/ai/generate-from-notes",
  authenticateToken,
  checkUploadLimit,
  checkFileSize,
  checkStorageLimit,
  checkTokenLimit(1000),
  conditionalFileValidation,
  trackUpload,
  trackTokenUsage,
  async (req, res) => {
    try {
      Logger.info("=== GENERATE FROM NOTES REQUEST RECEIVED ===", {
        userId: req.user?.id,
        bodyKeys: Object.keys(req.body || {}),
        hasFiles: !!(req.files && Object.keys(req.files).length > 0),
        hasValidatedFile: !!req.validatedFile,
        body: {
          topic: req.body.topic,
          difficulty: req.body.difficulty,
          numberOfQuestions: req.body.numberOfQuestions,
          hasText: !!(req.body.text && req.body.text.length > 0),
        },
      });

      // Fetch user to get default difficulty preference
      const user = await User.findById(req.user.id);
      const defaultDifficulty = user?.preferences?.defaultDifficulty || "medium";

      const { topic, numberOfQuestions = 10 } = req.body;
      const difficulty = req.body.difficulty || defaultDifficulty; // Use user's preference if not specified

      // Validate topic
      if (!topic || !Validators.topic(topic)) {
        Logger.warn("Generate from notes: Invalid topic", { topic, userId: req.user.id });
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_TOPIC",
            message: "Invalid topic. Use 3-50 alphanumeric characters and hyphens only",
            timestamp: new Date().toISOString(),
          },
        });
      }

      const validDifficulties = ["easy", "medium", "hard"];
      if (!validDifficulties.includes(difficulty.toLowerCase())) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_DIFFICULTY",
            message: "Difficulty must be: easy, medium, or hard",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Validate number of questions
      const questionsCount = parseInt(numberOfQuestions);
      if (isNaN(questionsCount) || questionsCount < 10 || questionsCount > 200) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_QUESTION_COUNT",
            message: "Number of questions must be between 10 and 200",
            timestamp: new Date().toISOString(),
          },
        });
      }

      const enforceQueueLimits = async () => {
        const maxUserJobs = Number(process.env.MAX_ACTIVE_JOBS_PER_USER) || 5;
        const maxGlobalJobs = Number(process.env.MAX_ACTIVE_JOBS_GLOBAL) || 500;

        const userActiveJobs = await getUserActiveJobs(req.user.id);
        if (userActiveJobs >= maxUserJobs) {
          return {
            allowed: false,
            statusCode: 503,
            error: {
              code: "USER_JOB_LIMIT",
              message: `You already have ${userActiveJobs} job(s) queued or processing. Please wait for at least one to finish.`,
              activeJobs: userActiveJobs,
              maxJobs: maxUserJobs,
              timestamp: new Date().toISOString(),
            },
          };
        }

        // Only reject if queue is truly saturated (safety valve, not normal operation)
        const globalCounts = await taskQueue.getJobCounts("active", "waiting", "delayed");
        const globalActive =
          (globalCounts.active || 0) +
          (globalCounts.waiting || 0) +
          (globalCounts.delayed || 0);
        if (globalActive >= maxGlobalJobs) {
          Logger.warn("Global queue saturation reached", { globalActive, maxGlobalJobs });
          return {
            allowed: false,
            statusCode: 503,
            error: {
              code: "QUEUE_OVERLOADED",
              message:
                "The system is experiencing unusually high demand. Please try again shortly.",
              queueDepth: globalActive,
              timestamp: new Date().toISOString(),
            },
          };
        }

        return { allowed: true };
      };

      let extractedText = "";
      let fileName = `AI_Generated_${topic}_${Date.now()}.json`;
      let batchMetadata = null;
      let batchProcessingTime = 0;
      const userId = new mongoose.Types.ObjectId(req.user.id);

      const computeDedupKey = (contentHash) => {
        const source = `${req.user.id}|${topic}|${difficulty}|${questionsCount}|${contentHash}`;
        return crypto.createHash("sha256").update(source).digest("hex").slice(0, 32);
      };

      // ===== MULTI-FILE UPLOAD PATH =====
      if (req.validatedFiles && req.validatedFiles.length > 1) {
        const files = req.validatedFiles;

        Logger.info("=== MULTI-FILE UPLOAD PATH ===", {
          fileCount: files.length,
          files: files.map((f) => ({ name: f.sanitizedName, size: f.size, ext: f.extension })),
          userId: req.user.id,
        });

        // Tier check: filesPerUpload limit
        const PricingConfig = require("./models/PricingConfig");
        const pricingConfig = await PricingConfig.getConfig();
        const user = await User.findById(req.user.id);
        const userTier = user?.subscriptionTier || "free"; // ← correct field
        const tierLimits = pricingConfig?.tiers?.[userTier]?.limits || {};
        const maxFilesAllowed = tierLimits.filesPerUpload || 1;

        if (files.length > maxFilesAllowed) {
          Logger.warn("Multi-file upload rejected - tier limit exceeded", {
            fileCount: files.length,
            maxAllowed: maxFilesAllowed,
            tier: userTier,
            userId: req.user.id,
          });
          return res.status(403).json({
            success: false,
            error: {
              code: "FILE_COUNT_EXCEEDED",
              message: `Your ${userTier} plan allows up to ${maxFilesAllowed} file(s) per upload. You uploaded ${files.length}.`,
              maxFiles: maxFilesAllowed,
              uploadedFiles: files.length,
              timestamp: new Date().toISOString(),
            },
          });
        }

        try {
          // Compute per-file content hashes
          const fileHashes = files.map((f) => ({
            contentHash: crypto.createHash("sha256").update(f.data).digest("hex"),
            fileName: f.sanitizedName,
            mimeType: f.mimeType,
            data: f.data,
            extension: f.extension,
            size: f.size,
          }));

          // Combined content hash (order-independent)
          const combinedContentHash = computeCombinedContentHash(fileHashes);
          const jobId = `quiz:${req.user.id}:${computeDedupKey(combinedContentHash)}`;

          const capacityCheck = await enforceQueueLimits();
          if (!capacityCheck.allowed) {
            return res.status(capacityCheck.statusCode || 503).json({
              success: false,
              error: capacityCheck.error,
            });
          }

          // Create ZIP bundle
          const { bundleBuffer, manifest } = createBundle(fileHashes);
          const bundleS3Key = buildBundleS3Key(req.user.id, files.length);

          // ── Fire-and-forget the Supabase upload ─────────────────────────
          // Uploading a large bundle synchronously during the HTTP request can
          // exceed Node.js's built-in 5-minute requestTimeout, causing the
          // server to send a 408 before our 202 — resulting in ERR_HTTP_HEADERS_SENT.
          // We pre-compute the storage key so the worker knows where to fetch from,
          // then start the upload in the background. The worker retries fetch
          // until the upload lands (see _processMultiFileJob Step 1).
          const _bundleRedisKey = `bundle_upload:${bundleS3Key}`;
          storageService
            .upload(
              bundleBuffer,
              bundleS3Key,
              "application/zip",
              req.user.organizationId || null,
              req.user.id,
            )
            .then(async () => {
              Logger.info("[S3 SUCCESS] Multi-file ZIP bundle uploaded (background)", {
                s3Key: bundleS3Key.substring(0, 40) + "...",
                bundleSizeBytes: bundleBuffer.length,
                fileCount: files.length,
                userId: req.user.id,
              });
              try {
                const _redis = getRedisClient();
                if (_redis) await _redis.set(_bundleRedisKey, "success", "EX", 600);
              } catch (_) {
                /* best-effort */
              }
            })
            .catch(async (err) => {
              Logger.error("[S3 FAIL] Multi-file ZIP bundle upload failed", {
                error: err.message,
                s3Key: bundleS3Key,
                userId: req.user.id,
              });
              try {
                const _redis = getRedisClient();
                if (_redis) await _redis.set(_bundleRedisKey, "failed", "EX", 600);
              } catch (_) {
                /* best-effort */
              }
            });

          // Build files metadata for job payload (no buffers — worker fetches from S3)
          const filesMetadata = fileHashes.map((f) => ({
            fileName: f.fileName,
            extension: f.extension,
            mimeType: f.mimeType,
            contentHash: f.contentHash,
            size: f.size,
          }));

          // Enqueue SINGLE job for all files
          const job = await taskQueue.add(
            `quiz-${userId}-${Date.now()}`,
            {
              userId: req.user.id,
              topic,
              difficulty,
              questionsCount,
              // Multi-file specific payload
              isMultiFile: true,
              s3BundleKey: bundleS3Key,
              files: filesMetadata,
              combinedContentHash,
              manifest,
            },
            { jobId },
          );

          try {
            await incrementUserActiveJobs(req.user.id);
          } catch (incrErr) {
            Logger.error("Failed to increment active jobs after multi-file enqueue", {
              error: incrErr.message,
            });
            await job.remove().catch(() => {});
            throw incrErr;
          }

          Logger.info("Multi-file job enqueued", {
            jobId: job.id,
            fileCount: files.length,
            combinedContentHash: combinedContentHash.substring(0, 16),
            userId: req.user.id,
          });

          return res.status(202).json({
            success: true,
            status: "processing",
            jobId: job.id,
            message: `${files.length} files queued for combined quiz generation`,
            fileCount: files.length,
          });
        } catch (err) {
          Logger.error("Error enqueuing multi-file quiz job:", {
            error: err.message,
            stack: err.stack,
          });
          return res.status(500).json({
            success: false,
            error: {
              code: "QUEUE_ERROR",
              message: "Failed to start multi-file background processing",
              timestamp: new Date().toISOString(),
            },
          });
        }
      }

      // ===== SINGLE FILE UPLOAD PATH (original — unchanged) =====
      if (req.validatedFile || (req.validatedFiles && req.validatedFiles.length === 1)) {
        // Normalize: if validatedFiles has exactly 1 entry, treat as single file
        const file = req.validatedFile || req.validatedFiles[0];

        fileName = file.sanitizedName;
        const fileBuffer = file.data;
        const ext = file.extension;

        Logger.info("Processing file for note generation", {
          fileName: file.sanitizedName,
          extension: ext,
          size: file.size,
          userId: req.user.id,
        });

        try {
          const contentHash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
          const jobId = `quiz:${req.user.id}:${computeDedupKey(contentHash)}`;

          const capacityCheck = await enforceQueueLimits();
          if (!capacityCheck.allowed) {
            return res.status(capacityCheck.statusCode || 503).json({
              success: false,
              error: capacityCheck.error,
            });
          }

          // Enqueue job instead of processing immediately\n          const s3FileKey = await uploadToStorage(\n            fileBuffer,\n            fileName,\n            file.mimetype,\n            req.user.id,\n            req.user.organizationId || null,\n          ).then((res) => res.Key);\n          Logger.info(`[Storage SUCCESS] File successfully uploaded`, {\n            s3FileKey,\n            userId: req.user.id,\n          });

          // BullMQ's jobId uniqueness prevents duplicate jobs atomically
          const job = await taskQueue.add(
            `quiz-${userId}-${Date.now()}`,
            {
              userId: req.user.id,
              topic,
              difficulty,
              questionsCount,
              s3FileKey,
              fileType: ext,
              fileName: file.sanitizedName,
              contentHash, // SHA256 of raw file bytes — used for global question cache key
            },
            { jobId },
          );

          try {
            await incrementUserActiveJobs(req.user.id);
          } catch (incrErr) {
            Logger.error("Failed to increment active jobs after enqueue, removing job", {
              error: incrErr.message,
            });
            await job.remove().catch(() => {});
            throw incrErr;
          }

          return res.status(202).json({
            success: true,
            status: "processing",
            jobId: job.id,
            message: "Quiz generation started in background",
          });
        } catch (err) {
          Logger.error("Error enqueuing quiz job for file:", { error: err.message });
          return res.status(500).json({
            success: false,
            error: {
              code: "QUEUE_ERROR",
              message: "Failed to start background processing",
              timestamp: new Date().toISOString(),
            },
          });
        }
      } else if (req.body.text) {
        // Text input path
        const text = req.body.text;

        try {
          const contentHash = crypto.createHash("sha256").update(text).digest("hex");
          const jobId = `quiz:${req.user.id}:${computeDedupKey(contentHash)}`;

          const capacityCheck = await enforceQueueLimits();
          if (!capacityCheck.allowed) {
            return res.status(capacityCheck.statusCode || 503).json({
              success: false,
              error: capacityCheck.error,
            });
          }

          // BullMQ's jobId uniqueness prevents duplicate jobs atomically
          const job = await taskQueue.add(
            `quiz-${userId}-${Date.now()}`,
            {
              userId: req.user.id,
              topic,
              difficulty,
              questionsCount,
              text,
              fileName: `Text_Input_${topic}.json`,
              contentHash, // SHA256 of text content — used for global question cache key
            },
            { jobId },
          );

          try {
            await incrementUserActiveJobs(req.user.id);
          } catch (incrErr) {
            Logger.error("Failed to increment active jobs after enqueue, removing job", {
              error: incrErr.message,
            });
            await job.remove().catch(() => {});
            throw incrErr;
          }

          return res.status(202).json({
            success: true,
            status: "processing",
            jobId: job.id,
            message: "Quiz generation started in background",
          });
        } catch (err) {
          Logger.error("Error enqueuing quiz job for text:", { error: err.message });
          return res.status(500).json({
            success: false,
            error: {
              code: "QUEUE_ERROR",
              message: "Failed to start background processing",
              timestamp: new Date().toISOString(),
            },
          });
        }
      } else {
        Logger.warn("Generate from notes: No file or text provided", {
          userId: req.user?.id,
          bodyKeys: Object.keys(req.body || {}),
          hasFiles: !!(req.files && Object.keys(req.files).length > 0),
        });
        return res.status(400).json({
          success: false,
          error: {
            code: "NO_INPUT",
            message: "Please provide either a file or text content",
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (err) {
      Logger.error("Fatal error in quiz generation route:", {
        error: err.message,
        stack: err.stack,
      });
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred. Our team has been notified.",
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  },
);

app.get("/api/questions", authenticateToken, async (req, res) => {
  try {
    const { topic, limit = 5 } = req.query;
    if (!topic) return res.status(400).json({ message: "Topic required" });

    // Validate topic format
    if (!Validators.topic(topic)) {
      return res.status(400).json({
        success: false,
        message: "Invalid topic format. Use 3-10 alphanumeric characters and hyphens only",
      });
    }

    // Escape regex special chars to prevent ReDoS
    const escapedTopic = escapeRegex(topic);
    const filter = { userId: req.user.id, topic: new RegExp(`^${escapedTopic}$`, "i") };
    const questions = await Question.aggregate([
      { $match: filter },
      { $sample: { size: Number(limit) } },
      { $project: { correctAnswer: 0, explanation: 0 } }, // Only exclude - MongoDB preserves _id automatically
    ]);
    return res.json(ResponseFormatter.success(questions));
  } catch (err) {
    console.error("questions error:", err);
    return res
      .status(500)
      .json(ResponseFormatter.error("Failed to fetch questions", "SERVER_ERROR"));
  }
});

app.get("/api/topics", authenticateToken, async (req, res) => {
  try {
    const userId = ensureObjectId(req.user.id);
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_USER_ID",
          message: "Invalid user ID format",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const topics = await PdfLibrary.find({ userId }).distinct("topic");

    const questionTopics = await Question.find({ userId }).distinct("topic");

    // Combine both sources and remove duplicates
    const allTopics = [...new Set([...topics, ...questionTopics])];

    res.json(allTopics.map((t) => ({ topic: t })));
  } catch (err) {
    console.error("Topics error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/user/quiz", authenticateToken, async (req, res) => {
  try {
    const { topic, limit = 5, mode = "Exam" } = req.query;
    if (!topic) return res.status(400).json({ message: "Topic is required" });

    // Validate topic format
    if (!Validators.topic(topic)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOPIC",
          message: "Invalid topic format. Use 3-10 alphanumeric characters and hyphens only",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const userId = ensureObjectId(req.user.id);
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_USER_ID",
          message: "Invalid user ID format",
          timestamp: new Date().toISOString(),
        },
      });
    }
    // Escape regex special chars to prevent ReDoS
    const escapedTopic = escapeRegex(topic);
    const filter = { userId, topic: new RegExp(`^${escapedTopic}$`, "i") };

    // Debug logging only in development
    if (process.env.NODE_ENV !== "production") {
      Logger.debug("Quiz query filter", { filter, userId, topic });
    }

    // For Practice mode, include correctAnswer and explanation
    // For Exam mode, exclude them for security
    const projectStage =
      mode === "Practice"
        ? {} // Include all fields
        : { $project: { correctAnswer: 0, explanation: 0 } }; // Only exclude - MongoDB preserves _id automatically

    let questions = await Question.aggregate([
      { $match: filter },
      { $sample: { size: parseInt(limit) } },
      ...(mode === "Practice" ? [] : [projectStage]), // Only add project stage for Exam mode
    ]);

    console.log("  DB query result:", questions.length, "questions found");
    if (questions.length > 0) {
      console.log("   Sample question _id:", questions[0]._id);
      console.log("   Sample question has _id?", !!questions[0]._id);
      console.log("   Sample question keys:", Object.keys(questions[0]));
    }

    if (questions.length === 0) {
      console.log("  No questions in DB, checking storage backup...");

      // List backup files via storageService
      const backupPrefix = `question_backups/${req.user.id}/${topic}`;
      const backupFiles = await storageService.list(
        backupPrefix,
        req.user.organizationId || null,
      );

      if (backupFiles && backupFiles.length > 0) {
        const latestBackup = backupFiles.sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at),
        )[0];

        const backupPath = `${backupPrefix}/${latestBackup.name}`;
        const { buffer: restoredBuffer } = await storageService.download(
          backupPath,
          req.user.organizationId || null,
        );

        let restoredQuestions = JSON.parse(restoredBuffer.toString("utf-8"));

        restoredQuestions = restoredQuestions
          .sort(() => Math.random() - 0.5)
          .slice(0, parseInt(limit));

        if (restoredQuestions.length > 0) {
          console.log("Restoring", restoredQuestions.length, "questions from backup");
          const insertedQuestions = await Question.insertMany(restoredQuestions);

          const backupSignedUrl = await getSignedStorageUrl(
            backupPath,
            req.user.organizationId || null,
            3600,
          );

          await PdfLibrary.create({
            userId,
            fileName: `Restored_${topic}.json`,
            topic,
            s3FileKey: latestBackup.Key,
            s3BackupKey: latestBackup.Key,
            numberOfQuestions: insertedQuestions.length,
            hasAnswers: insertedQuestions.some((q) => q.correctAnswer !== null),
            uploadedAt: new Date(),
          });

          // ⭐ CRITICAL: Get questions from DB to ensure they have _id fields
          questions = await Question.find({
            _id: { $in: insertedQuestions.map((q) => q._id) },
          }).lean();

          console.log("   Restored question sample _id:", questions[0]._id);
          console.log("   Restored question has _id?", !!questions[0]._id);

          // For Exam mode, remove correctAnswer from restored questions too
          if (mode !== "Practice") {
            questions = questions.map((q) => {
              const { correctAnswer, explanation, ...rest } = q;
              return {
                _id: q._id || q.id, // Explicitly preserve _id
                ...rest,
              };
            });
          }
        }
      }

      Logger.debug("Returning questions to frontend", { count: questions.length });
    }
    return res.json(questions);
  } catch (error) {
    console.error("Quiz error:", error);
    return res
      .status(500)
      .json(ResponseFormatter.error("Failed to fetch quiz", "SERVER_ERROR"));
  }
});

// --- Submit exam/practice (grade & persist) ---
app.post("/api/user/submit-exam", authenticateToken, async (req, res) => {
  try {
    const { topic, answers = [], timeSpentSeconds = 0, mode = "exam" } = req.body;

    // ===== VALIDATION =====
    if (!topic || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payload",
      });
    }

    // Validate mode
    const validMode = ["exam", "practice"].includes(mode) ? mode : "exam";

    //   FIX 1: Convert userId to ObjectId FIRST
    const userId = ensureObjectId(req.user.id);
    if (!userId) {
      Logger.error("Invalid user ID in submit-exam", {
        rawUserId: req.user.id,
        type: typeof req.user.id,
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_USER_ID",
          message: "Invalid user ID format",
          timestamp: new Date().toISOString(),
        },
      });
    }

    //  Validate all question IDs are valid ObjectIds
    const validAnswers = answers.filter((a) => {
      try {
        if (!a?.questionId) return false;
        new mongoose.Types.ObjectId(a.questionId);
        return true;
      } catch {
        Logger.warn("Invalid questionId in answer", { questionId: a?.questionId });
        return false;
      }
    });

    if (validAnswers.length === 0) {
      Logger.error("No valid question IDs in submission", {
        originalCount: answers.length,
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_QUESTION_IDS",
          message: "No valid question IDs in submission",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const ids = validAnswers.map((a) => new mongoose.Types.ObjectId(a.questionId));

    //   FIX 3: Use ObjectId for userId in query
    // Escape regex special chars to prevent ReDoS
    const escapedTopic = escapeRegex(topic);
    const questions = await Question.find({
      _id: { $in: ids },
      userId: userId,
      topic: new RegExp(`^${escapedTopic}$`, "i"), // Case-insensitive to match old and new data
    }).lean();

    //   FIX 4: If no questions found, provide detailed error
    if (questions.length === 0) {
      // Check if ANY questions exist for this user/topic
      const escapedTopicCheck = escapeRegex(topic);
      const anyQuestions = await Question.countDocuments({
        userId: userId,
        topic: new RegExp(`^${escapedTopicCheck}$`, "i"), // Case-insensitive
      });

      Logger.error("No matching questions found", {
        userId: userId.toString(),
        topic,
        requestedIds: ids.length,
        totalQuestionsForTopic: anyQuestions,
      });

      return res.status(404).json({
        success: false,
        error: {
          code: "NO_QUESTIONS_FOUND",
          message:
            anyQuestions === 0
              ? `No questions found for topic "${topic}". Please upload questions first.`
              : `Submitted question IDs don't match your questions for "${topic}".`,
          details: {
            userId: userId.toString(),
            topic,
            requestedQuestions: ids.length,
            existingQuestions: anyQuestions,
          },
          timestamp: new Date().toISOString(),
        },
      });
    }

    //   FIX 5: Map questions and grade
    const idToQuestion = new Map(questions.map((q) => [String(q._id), q]));
    let correctCount = 0;

    const graded = validAnswers.map((a) => {
      const q = idToQuestion.get(String(a.questionId));

      if (!q) {
        Logger.warn("Question not found during grading", {
          questionId: a.questionId,
        });
        return {
          questionId: a.questionId,
          questionText: "",
          questionType: a.questionType || "multiple-choice",
          selectedIndex: typeof a.selectedIndex === "number" ? a.selectedIndex : null,
          selectedText: typeof a.selectedText === "string" ? a.selectedText : null,
          correctIndex: null,
          isCorrect: false,
        };
      }

      const qType = q.questionType || "multiple-choice";
      let isCorrect = false;

      if (qType === "fill-in-blank") {
        // Compare text answer to blankAnswer (case-insensitive, trimmed)
        const submitted = (a.selectedText || "").trim().toLowerCase();
        const expected = (q.blankAnswer || "").trim().toLowerCase();
        isCorrect = submitted.length > 0 && submitted === expected;
      } else if (qType === "theory") {
        // Theory questions are always marked as needing manual review
        isCorrect = false;
      } else {
        // MCQ / true-false: compare index
        isCorrect =
          a.selectedIndex !== null &&
          a.selectedIndex !== undefined &&
          typeof a.selectedIndex === "number" &&
          a.selectedIndex === q.correctAnswer;
      }

      if (isCorrect) correctCount += 1;

      return {
        questionId: q._id,
        questionText: q.questionText,
        questionType: qType,
        selectedIndex: typeof a.selectedIndex === "number" ? a.selectedIndex : null,
        selectedText: typeof a.selectedText === "string" ? a.selectedText : null,
        correctIndex: q.correctAnswer ?? null,
        correctText:
          qType === "fill-in-blank"
            ? q.blankAnswer || null
            : qType === "theory"
              ? q.modelAnswer || null
              : null,
        isCorrect,
      };
    });

    const total = validAnswers.length || questions.length || 0;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    //   FIX 6: Save result with ObjectId userId
    const resultDoc = await Result.create({
      userId: userId, //   Using ObjectId
      topic,
      totalQuestions: total,
      correctCount,
      percentage,
      timeSpentSeconds: timeSpentSeconds || 0,
      mode: validMode,
      answers: graded,
    });

    // Increment usage.quizzesTaken atomically — this was missing (hence always 0)
    User.findByIdAndUpdate(
      userId,
      {
        $inc: { "usage.quizzesTaken": 1 },
      },
      { new: false },
    ).catch((err) => {
      Logger.error("Failed to increment quizzesTaken", {
        userId: userId.toString(),
        error: err.message,
      });
    });

    return res.json(
      ResponseFormatter.success({
        correctCount,
        total,
        percentage,
        answers: graded,
        resultId: resultDoc._id,
      }),
    );
  } catch (err) {
    Logger.error("Submit exam error", {
      error: err.message,
      stack: err.stack,
      userId: req.user?.id,
    });

    return res
      .status(500)
      .json(ResponseFormatter.error("Failed to submit exam", "SERVER_ERROR"));
  }
});

app.get("/api/results", authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const userId = ensureObjectId(req.user.id);
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_USER_ID",
          message: "Invalid user ID format",
          timestamp: new Date().toISOString(),
        },
      });
    }
    const total = await Result.countDocuments({ userId });
    const results = await Result.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    return res.json(
      ResponseFormatter.successPaginated(results, {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalResults: total,
        resultsPerPage: parseInt(limit),
      }),
    );
  } catch (err) {
    console.error("Results error:", err);
    return res
      .status(500)
      .json(ResponseFormatter.error("Failed to fetch results", "SERVER_ERROR"));
  }
});

// --- Get single result detail with question breakdown ---
app.get("/api/results/:resultId", authenticateToken, async (req, res) => {
  try {
    const { resultId } = req.params;

    // Validate resultId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(resultId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_RESULT_ID",
          message: "Invalid result ID format",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const userId = ensureObjectId(req.user.id);
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_USER_ID",
          message: "Invalid user ID format",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Fetch result from database
    const result = await Result.findById(resultId).lean();

    if (!result) {
      return res.status(404).json({
        success: false,
        error: {
          code: "RESULT_NOT_FOUND",
          message: "Result not found",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Verify result belongs to authenticated user
    if (result.userId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        error: {
          code: "UNAUTHORIZED_ACCESS",
          message: "You do not have permission to access this result",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Fetch full question details for each answer
    const questionIds = result.answers.map((a) => a.questionId).filter((id) => id);
    const questions = await Question.find({ _id: { $in: questionIds } }).lean();

    // Create a map of questions by ID for quick lookup
    const questionMap = {};
    questions.forEach((q) => {
      questionMap[q._id.toString()] = q;
    });

    // Enrich answers with full question details
    const enrichedAnswers = result.answers.map((answer, index) => {
      const question = questionMap[answer.questionId?.toString()];
      const qType = question?.questionType || answer.questionType || "multiple-choice";
      const isFill = qType === "fill-in-blank" || qType === "fill-in-gap";
      const isTheory = qType === "theory" || qType === "short-answer" || qType === "essay";

      return {
        questionNumber: index + 1,
        questionText: answer.questionText,
        questionType: qType,
        difficulty: question?.difficulty || "medium",
        options: question?.options || [],

        userSelectedIndex:
          answer.selectedIndex !== null && answer.selectedIndex !== undefined
            ? answer.selectedIndex
            : null,
        userSelectedText: answer.selectedText || null,
        correctAnswerIndex: answer.correctIndex,
        blankAnswer: isFill ? question?.blankAnswer || null : null,
        modelAnswer: isTheory ? question?.modelAnswer || null : null,
        isCorrect: answer.isCorrect,
        isSkipped:
          isFill || isTheory
            ? !(answer.selectedText && answer.selectedText.trim().length > 0)
            : answer.selectedIndex === null || answer.selectedIndex === undefined,

        explanation: question?.explanation || "",
        topic: question?.topic || result.topic,
      };
    });

    // Calculate skipped count
    const skippedCount = enrichedAnswers.filter((a) => a.isSkipped).length;

    // Calculate topic breakdown (if multi-topic)
    const topicStats = {};
    enrichedAnswers.forEach((answer) => {
      const topic = answer.topic || "Unknown";
      if (!topicStats[topic]) {
        topicStats[topic] = { total: 0, correct: 0 };
      }
      topicStats[topic].total++;
      if (answer.isCorrect) {
        topicStats[topic].correct++;
      }
    });

    const topicBreakdown = Object.keys(topicStats).map((topic) => ({
      topic,
      totalInQuiz: topicStats[topic].total,
      correctInTopic: topicStats[topic].correct,
      percentageInTopic: Math.round(
        (topicStats[topic].correct / topicStats[topic].total) * 100,
      ),
    }));

    // Return formatted response
    return res.json({
      success: true,
      data: {
        resultId: result._id,
        userId: result.userId,
        topic: result.topic,
        createdAt: result.createdAt,
        timeSpentSeconds: result.timeSpentSeconds || 0,

        // Score Summary
        totalQuestions: result.totalQuestions,
        correctCount: result.correctCount,
        skippedCount,
        percentage: result.percentage,

        // Detailed Answers
        answers: enrichedAnswers,

        // Topic breakdown (only include if multi-topic)
        topicBreakdown: topicBreakdown.length > 1 ? topicBreakdown : null,
      },
    });
  } catch (err) {
    Logger.error("Error fetching result detail", {
      error: err.message,
      stack: err.stack,
      resultId: req.params.resultId,
      userId: req.user?.id,
    });

    return res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Failed to fetch result details",
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// --- Get user uploads ---
app.get("/api/user/uploads", authenticateToken, async (req, res) => {
  try {
    const userId = ensureObjectId(req.user.id);
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_USER_ID",
          message: "Invalid user ID format",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const uploads = await PdfLibrary.find({ userId })
      .sort({ uploadedAt: -1 })
      .select("_id fileName topic numberOfQuestions hasAnswers uploadedAt jobId s3BundleKey")
      .lean();

    return res.json(ResponseFormatter.success(uploads));
  } catch (err) {
    console.error("Uploads error:", err);
    return res
      .status(500)
      .json(ResponseFormatter.error("Failed to fetch uploads", "SERVER_ERROR"));
  }
});
// ===== Auth: Logout =====
app.post("/api/auth/logout", authenticateToken, async (req, res) => {
  try {
    const TokenService = require("./services/tokenService");

    // Revoke the access token by JTI (if available)
    // Use tokenDecoded which contains the actual decoded JWT payload
    const jti = req.tokenDecoded?.jti || req.user?.jti;
    if (jti) {
      // Calculate remaining TTL for access token
      const exp = req.tokenDecoded?.exp || req.user?.exp;
      const remainingTTL = exp ? Math.max(0, exp - Math.floor(Date.now() / 1000)) : 900;
      await TokenService.revokeToken(jti, remainingTTL);
    }

    // Clear refresh token cookie
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });

    res.json({
      success: true,
      message: "Logged out successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Logger.error("Logout error", { error: err.message });

    // Even on error, clear the cookie
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });

    res.json({
      success: true,
      message: "Logged out",
      timestamp: new Date().toISOString(),
    });
  }
});

// ===== Auth: Refresh Token =====
app.post("/api/auth/refresh", (req, res) => {
  try {
    const TokenService = require("./services/tokenService");
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: {
          code: "NO_REFRESH_TOKEN",
          message: "Refresh token required",
        },
      });
    }

    // Verify refresh token
    const decoded = TokenService.verifyRefreshToken(refreshToken);

    User.findById(decoded.id)
      .then((user) => {
        if (!user || !user.isActive) {
          return res.status(403).json({
            success: false,
            error: {
              code: "USER_INACTIVE",
              message: "User account is inactive",
            },
          });
        }

        // Generate new access token
        const accessToken = TokenService.generateAccessToken(user);

        res.cookie("token", accessToken, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          maxAge: 60 * 60 * 1000, // 1 hour
          path: "/",
        });

        res.json({
          success: true,
          data: {
            accessToken,
            user: {
              id: user._id,
              email: user.email,
              role: user.role,
            },
          },
          timestamp: new Date().toISOString(),
        });
      })
      .catch((err) => {
        Logger.error("Refresh token error", { error: err.message });
        res.status(500).json({
          success: false,
          error: {
            code: "REFRESH_ERROR",
            message: "Failed to refresh token",
          },
        });
      });
  } catch (err) {
    Logger.error("Refresh token verification error", { error: err.message });
    return res.status(401).json({
      success: false,
      error: {
        code: "INVALID_REFRESH_TOKEN",
        message: "Invalid or expired refresh token",
      },
    });
  }
});

app.get("/api/auth/verify", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: "User not found" },
      });
    }

    const userRole = user.role || "user";
    const isAdmin = userRole === "admin" || userRole === "superadmin";
    const isSuperAdmin = userRole === "superadmin";

    // Return live PricingConfig limits so the frontend never works off
    // stale stored values (e.g. after a tier upgrade or config change).
    let verifyLiveLimits = user.limits || {};
    try {
      const PricingConfigModel = require("./models/PricingConfig");
      const verifyCfg = await PricingConfigModel.getConfig();
      const verifyTier = user.subscriptionTier || "free";
      const cfgLimits = verifyCfg?.tiers?.[verifyTier]?.limits;
      if (cfgLimits) {
        verifyLiveLimits = { ...cfgLimits, ...user.limits };
        [
          "filesPerUpload",
          "maxFileSizeMB",
          "questionsPerUpload",
          "uploadsPerMonth",
          "uploadsPerDay",
          "tokensPerMonth",
          "tokensPerRequest",
          "maxStorageMB",
        ].forEach((f) => {
          if (cfgLimits[f] !== undefined) verifyLiveLimits[f] = cfgLimits[f];
        });
      }
    } catch (_limitsErr) {
      /* non-fatal — fall back to stored limits */
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          username: user.username,
          fullname: user.fullname,
          role: userRole,
          isAdmin,
          isSuperAdmin,
          subscriptionTier: user.subscriptionTier || "free",
          subscriptionStatus: user.subscriptionStatus || "active",
          limits: verifyLiveLimits,
          usage: user.usage,
          isActive: user.isActive,
          createdAt: user.createdAt,
          // B2B org-scoped fields
          orgRole: user.orgRole || null,
          organizationId: user.organizationId || null,
          classId: user.classId || null,
        },
        isAdmin,
        isSuperAdmin,
        redirectTo: isAdmin ? "/admin" : "/Dashboard",
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Logger.error("Verify error", { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: "VERIFICATION_FAILED",
        message: "Verification failed",
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// ===== User Settings: Profile Update =====
app.put("/api/user/profile", authenticateToken, async (req, res, next) => {
  try {
    const { fullname, username, email, defaultDifficulty } = req.body;
    const userId = req.user?.id;

    // Check if user is authenticated
    if (!userId) {
      Logger.error("Profile update: No user ID", {
        hasReqUser: !!req.user,
        userKeys: req.user ? Object.keys(req.user) : [],
      });
      return res.status(401).json({
        success: false,
        error: {
          code: "NOT_AUTHENTICATED",
          message: "Authentication required",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Validate inputs
    if (!fullname || !username || !email) {
      Logger.warn("Profile update: Missing fields", {
        hasFullname: !!fullname,
        hasUsername: !!username,
        hasEmail: !!email,
        userId,
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_FIELDS",
          message: "All fields are required",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Validate username format (3-20 alphanumeric characters)
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_USERNAME",
          message:
            "Username must be 3-20 characters and contain only letters, numbers, hyphens, and underscores",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_EMAIL",
          message: "Please enter a valid email address",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Check if email is already used by another user
    const existingEmail = await User.findOne({
      email: email.toLowerCase(),
      _id: { $ne: userId },
    });

    if (existingEmail) {
      Logger.warn("Profile update: Email already used", { email, userId });
      return res.status(409).json({
        success: false,
        error: {
          code: "EMAIL_ALREADY_USED",
          message: "Email already in use by another account",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Check if username is already used by another user
    const existingUsername = await User.findOne({
      username: username.toLowerCase(),
      _id: { $ne: userId },
    });

    if (existingUsername) {
      Logger.warn("Profile update: Username already used", { username, userId });
      return res.status(409).json({
        success: false,
        error: {
          code: "USERNAME_ALREADY_USED",
          message: "Username already in use by another account",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Update user
    const updateData = {
      fullname: fullname.trim(),
      username: username.toLowerCase().trim(),
      email: email.toLowerCase().trim(),
      updatedAt: new Date(),
    };

    // Update difficulty preference if provided
    if (defaultDifficulty && ["easy", "medium", "hard"].includes(defaultDifficulty)) {
      updateData["preferences.defaultDifficulty"] = defaultDifficulty;
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!updatedUser) {
      Logger.error("Profile update: User not found", { userId });
      return res.status(404).json({
        success: false,
        error: {
          code: "USER_NOT_FOUND",
          message: "User not found",
          timestamp: new Date().toISOString(),
        },
      });
    }

    Logger.info("Profile updated successfully", {
      userId,
      username: updatedUser.username,
      email: updatedUser.email,
    });

    res.json({
      success: true,
      data: { user: updatedUser },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error("Profile update error", {
      error: error.message,
      code: error.code,
      name: error.name,
      userId: req.user?.id,
      stack: error.stack,
    });

    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      const message =
        field === "email"
          ? "Email already in use by another account"
          : field === "username"
            ? "Username already in use by another account"
            : "This information is already in use by another account";

      return res.status(409).json({
        success: false,
        error: {
          code: "DUPLICATE_ERROR",
          message,
          field,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: Object.values(error.errors)
            .map((e) => e.message)
            .join(", "),
          timestamp: new Date().toISOString(),
        },
      });
    }

    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to update profile. Please try again later",
        details: process.env.NODE_ENV === "development" ? error.message : undefined,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// ===== User Settings: Password Change =====

app.put("/api/user/password", authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id;

    //  Validate required fields
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_FIELDS",
          message: "All password fields are required",
          timestamp: new Date().toISOString(),
        },
      });
    }

    //  Confirm new passwords match
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        error: {
          code: "PASSWORD_MISMATCH",
          message: "New passwords do not match",
          timestamp: new Date().toISOString(),
        },
      });
    }

    //  Validate new password strength
    const passwordValidation = PasswordValidator.validate(newPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_PASSWORD",
          message: "New password does not meet strength requirements",
          details: passwordValidation.errors,
          strength: passwordValidation.strength,
          score: passwordValidation.score,
          timestamp: new Date().toISOString(),
        },
      });
    }

    //  Fetch user with password
    const user = await User.findById(userId).select("+password");
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: "USER_NOT_FOUND",
          message: "User not found",
          timestamp: new Date().toISOString(),
        },
      });
    }

    //   Verify current password
    const isMatch = await PasswordValidator.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_PASSWORD",
          message: "Current password is incorrect",
          timestamp: new Date().toISOString(),
        },
      });
    }

    //   Hash and update new password
    const hashedPassword = await PasswordValidator.hash(newPassword);
    user.password = hashedPassword;
    await user.save();

    Logger.info("Password changed", { userId });

    res.json({
      success: true,
      data: { message: "Password changed successfully" },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error("Password change error", { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to change password. Please try again later",
        timestamp: new Date().toISOString(),
      },
    });
  }
});

app.get("/api/user/export-data", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [user, questions, results, uploads] = await Promise.all([
      User.findById(userId).select("-password"),
      Question.find({ userId }),
      Result.find({ userId }),
      PdfLibrary.find({ userId }),
    ]);

    const exportData = {
      user,
      questionsCount: questions.length,
      resultsCount: results.length,
      uploadsCount: uploads.length,
      exportedAt: new Date(),
      questions: questions.slice(0, 100),
      results: results.slice(0, 100),
      uploads,
    };

    res.json(ResponseFormatter.success(exportData));
  } catch (error) {
    console.error("Data export error:", error);
    if (!res.headersSent) res.status(500).json({ error: "Failed to export data" });
  }
});

// ===== Request OTP for Account Deletion =====
app.post("/api/user/request-delete-otp", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: "USER_NOT_FOUND",
          message: "User not found",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in Redis with 10-minute expiration
    const redis = getRedisClient();
    await redis.setEx(
      `account_delete_otp:${userId}`,
      600, // 10 minutes
      otp,
    );

    // Send OTP via email
    const emailService = require("./services/emailService");
    await emailService.sendAccountDeletionOTP(user.email, user.fullname, otp);

    Logger.info("Account deletion OTP sent", { userId, email: user.email });

    res.json({
      success: true,
      data: {
        message: "Verification code sent to your email",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    Logger.error("Request delete OTP error", { error: error.message, userId: req.user.id });
    if (!res.headersSent)
      res.status(500).json({
        success: false,
        error: {
          code: "OTP_SEND_FAILED",
          message: "Failed to send verification code",
          timestamp: new Date().toISOString(),
        },
      });
  }
});

app.delete("/api/user/account", authenticateToken, async (req, res) => {
  try {
    const { password, otp } = req.body;
    const userId = req.user.id;

    if (!password && !otp) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_FIELDS",
          message: "Password or OTP is required to delete account",
          timestamp: new Date().toISOString(),
        },
      });
    }

    const user = await User.findById(userId).select("+password");
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: "USER_NOT_FOUND",
          message: "User not found",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Verify OTP if provided
    if (otp) {
      const redis = getRedisClient();
      const storedOtp = await redis.get(`account_delete_otp:${userId}`);

      if (!storedOtp || storedOtp !== otp) {
        Logger.warn("Account deletion: Invalid OTP", { userId });
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_OTP",
            message: "Invalid or expired verification code",
            timestamp: new Date().toISOString(),
          },
        });
      }

      // Clear OTP after successful verification
      await redis.del(`account_delete_otp:${userId}`);
    }
    // Verify password if provided (legacy support)
    else if (password) {
      const isMatch = await PasswordValidator.compare(password, user.password);
      if (!isMatch) {
        Logger.warn("Account deletion: Wrong password", { userId });
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_PASSWORD",
            message: "Incorrect password",
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    await Promise.all([
      User.findByIdAndDelete(userId),
      Question.deleteMany({ userId }),
      Result.deleteMany({ userId }),
      PdfLibrary.deleteMany({ userId }),
    ]);

    res.json(
      ResponseFormatter.success({
        message: "Account and all associated data have been deleted",
      }),
    );
  } catch (error) {
    console.error("Account deletion error:", error);
    if (!res.headersSent) res.status(500).json({ error: "Failed to delete account" });
  }
});

// ===== Contact Form Endpoint =====

app.post("/api/contact", validateContact, async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    // Generate unique ticket ID
    const ticketId = await Contact.generateTicketId();

    //   Create contact record with ticket ID
    const contactData = {
      ticketId,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      subject: subject.trim(),
      message: message.trim(),
      createdAt: new Date(),
      status: "new",
    };

    const contact = await Contact.create(contactData);

    // Respond immediately — don't block on email delivery
    res.json({
      success: true,
      data: {
        message: "Thank you for your message. We will get back to you soon!",
        ticketId: contact.ticketId,
        ticketInfo:
          "Please save this ticket ID for your records. You can use it to track your inquiry.",
      },
      error: null,
      timestamp: new Date().toISOString(),
    });

    // Fire-and-forget: send emails in background after response is sent
    const emailService = require("./services/emailService");

    emailService.sendContactNotificationToAdmins(contact).catch((emailError) => {
      Logger.error("Failed to send admin notification", {
        contactId: contact._id,
        ticketId: contact.ticketId,
        error: emailError.message,
      });
    });

    emailService.sendContactConfirmation(contact).catch((emailError) => {
      Logger.error("Failed to send confirmation email", {
        contactId: contact._id,
        ticketId: contact.ticketId,
        error: emailError.message,
      });
    });
  } catch (error) {
    Logger.error("Contact form error", { error: error.message });
    if (!res.headersSent)
      res.status(500).json({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to send message. Please try again later",
          timestamp: new Date().toISOString(),
        },
      });
  }
});

app.get("/api/user/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: "USER_NOT_FOUND",
          message: "User not found",
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Always serve LIVE tier limits from PricingConfig so the frontend
    // reflects the current plan — stale user.limits in the DB can lag
    // behind config changes or tier upgrades.
    let liveLimits = user.limits || {};
    try {
      const PricingConfigModel = require("./models/PricingConfig");
      const pricingCfgDoc = await PricingConfigModel.getConfig();
      const tier = user.subscriptionTier || "free";
      const tierLimitsFromConfig = pricingCfgDoc?.tiers?.[tier]?.limits;
      if (tierLimitsFromConfig) {
        // Merge: PricingConfig is authoritative; stored limits supply only
        // admin-granted custom overrides (fields absent in config).
        liveLimits = { ...tierLimitsFromConfig, ...user.limits };
        // Protect against stale lower values: config wins for filesPerUpload
        // and other key quota fields.
        const override = (field) => {
          if (tierLimitsFromConfig[field] !== undefined) {
            liveLimits[field] = tierLimitsFromConfig[field];
          }
        };
        [
          "filesPerUpload",
          "maxFileSizeMB",
          "questionsPerUpload",
          "uploadsPerMonth",
          "uploadsPerDay",
          "tokensPerMonth",
          "tokensPerRequest",
          "maxStorageMB",
        ].forEach(override);
      }
    } catch (limitsErr) {
      Logger.warn("Could not load live tier limits for profile", { error: limitsErr.message });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          fullname: user.fullname,
          role: user.role,
          subscriptionTier: user.subscriptionTier,
          subscriptionStatus: user.subscriptionStatus,
          subscriptionExpiry: user.subscriptionExpiry,
          usage: user.usage,
          limits: liveLimits,
          // NEW: Calculate remaining quota
          remainingQuota: {
            uploads: user.getRemainingUploads(),
            storage: user.getRemainingStorage(),
            token: user.getRemainingTokens(),
          },
        },
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Logger.error("Get profile error", { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Failed to fetch profile",
        timestamp: new Date().toISOString(),
      },
    });
  }
});

app.get("/api/user/usage", authenticateToken, async (req, res) => {
  try {
    const user = req.user;

    const usageStats = {
      tier: user.subscriptionTier,
      status: user.subscriptionStatus,
      expiry: user.subscriptionExpiry,

      usage: {
        tokens: user.usage.tokenUsedThisMonth,
        uploads: user.usage.uploadsThisMonth,
        storage: user.usage.storageUsedMB,
        lastReset: user.usage.lastResetDate,
      },

      // Limits
      Limits: {
        uploads: user.limits.uploadsPerMonth,
        storage: user.limits.maxStorageMB,
        maxFileSize: user.limits.maxFileSizeMB,
        token: user.limits.tokensPerMonth,
        tokenPerRequest: user.limits.tokensPerRequest,
        questionsPerUpload: user.limits.questionsPerUpload,
      },

      // Remaining quota
      remaining: {
        uploads: user.getRemainingUploads(),
        storage: user.getRemainingStorage(),
        token: user.getRemainingTokens(),
      },

      // Percentage used
      percentageUsed: {
        uploads:
          user.limits.uploadsPerMonth === -1
            ? 0
            : Math.round((user.usage.uploadsThisMonth / user.limits.uploadsPerMonth) * 100),
        storage:
          user.limits.maxStorageMB === -1
            ? 0
            : Math.round((user.usage.storageUsedMB / user.limits.maxStorageMB) * 100),
        tokens:
          user.limits.tokensPerMonth === -1
            ? 0
            : Math.round((user.usage.tokensUsedThisMonth / user.limits.tokensPerMonth) * 100),
      },
    };

    res.json({
      success: true,
      data: usageStats,
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Logger.error("Get usage error", { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Failed to fetch usage stats",
        timestamp: new Date().toISOString(),
      },
    });
  }
});

app.post("/api/user/upgrade", authenticateToken, async (req, res) => {
  try {
    const { tier, billingCycle = "monthly" } = req.body;

    const validTiers = ["starter", "pro"];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TIER",
          message: "Invalid subscription tier. Valid tiers: starter, pro",
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (!["monthly", "yearly"].includes(billingCycle)) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_BILLING", message: "Billing cycle must be monthly or yearly" },
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }

    // Prevent downgrade via this endpoint
    const tierOrder = { free: 0, starter: 1, pro: 2 };
    if (tierOrder[tier] <= tierOrder[user.subscriptionTier]) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_UPGRADE",
          message: "Cannot upgrade to same or lower tier. Use downgrade endpoint instead.",
        },
      });
    }

    // Get pricing from admin-editable PricingConfig (single source of truth)
    const PricingConfig = require("./models/PricingConfig");
    const pricingConfig = await PricingConfig.getConfig();
    const tierConfig = pricingConfig.tiers[tier];

    if (!tierConfig) {
      return res.status(400).json({
        success: false,
        error: { code: "TIER_NOT_CONFIGURED", message: "Tier pricing not configured" },
      });
    }

    // Price is stored in USD cents in PricingConfig
    const priceUSDCents =
      billingCycle === "yearly" ? tierConfig.yearlyUSD : tierConfig.monthlyUSD;

    // Convert USD cents to NGN kobo for Paystack
    // 1 USD = exchangeRates.NGN NGN, cents → kobo: multiply by rate
    const ngnRate = pricingConfig.exchangeRates?.NGN || 1600;
    const amountInKobo = Math.round((priceUSDCents / 100) * ngnRate * 100); // USD → NGN → kobo

    // Initialize Paystack transaction
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecretKey) {
      return res.status(503).json({
        success: false,
        error: { code: "PAYMENT_UNAVAILABLE", message: "Payment service not configured" },
      });
    }

    const https = require("https");
    const paystackData = JSON.stringify({
      email: user.email,
      amount: amountInKobo, // Amount in kobo (NGN smallest unit)
      currency: "NGN",
      callback_url: `${process.env.FRONTEND_URL || "http://localhost:5173"}/payment/callback`,
      metadata: {
        userId: user._id.toString(),
        tier,
        billingCycle,
        priceUSDCents, // Store original USD price for reference
        ngnRate, // Store exchange rate used
        custom_fields: [
          { display_name: "Plan", variable_name: "plan", value: tier },
          { display_name: "Billing", variable_name: "billing", value: billingCycle },
          { display_name: "Username", variable_name: "username", value: user.username },
        ],
      },
      channels: ["card", "bank", "ussd", "bank_transfer"],
    });

    const initTransaction = () =>
      new Promise((resolve, reject) => {
        const options = {
          hostname: "api.paystack.co",
          port: 443,
          path: "/transaction/initialize",
          method: "POST",
          headers: {
            Authorization: `Bearer ${paystackSecretKey}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(paystackData),
          },
        };

        const reqPaystack = https.request(options, (respPaystack) => {
          let data = "";
          respPaystack.on("data", (chunk) => (data += chunk));
          respPaystack.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error("Invalid Paystack response"));
            }
          });
        });

        reqPaystack.on("error", reject);
        reqPaystack.write(paystackData);
        reqPaystack.end();
      });

    const paystackResponse = await initTransaction();

    if (!paystackResponse.status) {
      Logger.error("Paystack init failed", { response: paystackResponse });
      return res.status(502).json({
        success: false,
        error: {
          code: "PAYMENT_INIT_FAILED",
          message: paystackResponse.message || "Failed to initialize payment",
          detail: paystackResponse,
        },
      });
    }

    Logger.info("Payment initialized", {
      userId: user._id,
      tier,
      amountKobo: amountInKobo,
      priceUSDCents,
      ngnRate,
      reference: paystackResponse.data.reference,
    });

    res.json({
      success: true,
      data: {
        authorizationUrl: paystackResponse.data.authorization_url,
        accessCode: paystackResponse.data.access_code,
        reference: paystackResponse.data.reference,
        tier,
        amount: amountInKobo,
        priceUSD: (priceUSDCents / 100).toFixed(2),
        billingCycle,
      },
      error: null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    Logger.error("Upgrade tier error", { error: err.message });
    res.status(500).json({
      success: false,
      error: {
        code: "SERVER_ERROR",
        message: "Failed to process upgrade",
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// ===== PAYSTACK WEBHOOK =====
app.post(
  "/api/paystack/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const crypto = require("crypto");
      const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;

      // Get raw body for signature verification
      const rawBody =
        req.body instanceof Buffer ? req.body.toString("utf8") : JSON.stringify(req.body);

      // Verify webhook signature
      const hash = crypto
        .createHmac("sha512", paystackSecretKey)
        .update(rawBody)
        .digest("hex");

      if (hash !== req.headers["x-paystack-signature"]) {
        Logger.warn("Invalid Paystack webhook signature");
        return res.status(401).json({ message: "Invalid signature" });
      }

      const event = JSON.parse(rawBody);
      Logger.info("Paystack webhook received", { event: event.event });

      switch (event.event) {
        case "charge.success": {
          const { reference, metadata, customer, authorization } = event.data;
          const { userId, tier, billingCycle } = metadata || {};

          if (!userId || !tier) {
            Logger.warn("Webhook missing metadata", { reference });
            break;
          }

          const user = await User.findById(userId);
          if (!user) {
            Logger.error("Webhook user not found", { userId });
            break;
          }

          // Update user tier and payment info
          // Read limits from live PricingConfig (admin-editable) → hardcoded fallback
          const tierLimits = await User.getLiveTierLimits(tier);

          user.subscriptionTier = tier;
          user.subscriptionStatus = "active";
          user.subscriptionStartDate = new Date();
          user.limits = { ...tierLimits };

          // Set expiry based on billing cycle
          const expiry = new Date();
          if (billingCycle === "yearly") {
            expiry.setFullYear(expiry.getFullYear() + 1);
          } else {
            expiry.setMonth(expiry.getMonth() + 1);
          }
          user.subscriptionExpiry = expiry;

          // Save Paystack customer info
          if (customer) {
            user.paystackCustomerId = customer.customer_code || customer.id;
          }
          if (authorization) {
            user.paystackAuthorizationCode = authorization.authorization_code;
          }

          await user.save();

          Logger.info("Subscription activated via webhook", {
            userId,
            tier,
            expiry,
            reference,
          });
          break;
        }

        case "subscription.create": {
          const { customer, subscription_code } = event.data;
          const user = await User.findOne({
            $or: [{ paystackCustomerId: customer?.customer_code }, { email: customer?.email }],
          });
          if (user) {
            user.paystackSubscriptionCode = subscription_code;
            await user.save();
            Logger.info("Subscription code saved", { userId: user._id, subscription_code });
          }
          break;
        }

        case "subscription.disable":
        case "charge.failed": {
          const { customer } = event.data;
          const user = await User.findOne({
            $or: [{ paystackCustomerId: customer?.customer_code }, { email: customer?.email }],
          });
          if (user) {
            user.subscriptionStatus =
              event.event === "charge.failed" ? "past_due" : "cancelled";
            await user.save();
            Logger.info("Subscription issue", { userId: user._id, event: event.event });
          }
          break;
        }

        case "invoice.payment_failed": {
          const { customer } = event.data;
          const user = await User.findOne({
            $or: [{ paystackCustomerId: customer?.customer_code }, { email: customer?.email }],
          });
          if (user) {
            user.subscriptionStatus = "past_due";
            await user.save();
            Logger.warn("Invoice payment failed", { userId: user._id });
          }
          break;
        }

        default:
          Logger.info("Unhandled Paystack event", { event: event.event });
      }

      // Always respond 200 to Paystack
      res.status(200).json({ received: true });
    } catch (err) {
      Logger.error("Paystack webhook error", { error: err.message });
      res.status(200).json({ received: true }); // Still respond 200 to prevent retries
    }
  },
);

// ===== VERIFY PAYMENT =====
app.get("/api/paystack/verify/:reference", authenticateToken, async (req, res) => {
  try {
    const { reference } = req.params;
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!paystackSecretKey) {
      return res.status(503).json({
        success: false,
        error: { code: "PAYMENT_UNAVAILABLE", message: "Payment not configured" },
      });
    }

    const https = require("https");
    const verifyPayment = () =>
      new Promise((resolve, reject) => {
        const options = {
          hostname: "api.paystack.co",
          port: 443,
          path: `/transaction/verify/${encodeURIComponent(reference)}`,
          method: "GET",
          headers: { Authorization: `Bearer ${paystackSecretKey}` },
        };

        const reqPaystack = https.request(options, (respPaystack) => {
          let data = "";
          respPaystack.on("data", (chunk) => (data += chunk));
          respPaystack.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error("Invalid response"));
            }
          });
        });
        reqPaystack.on("error", reject);
        reqPaystack.end();
      });

    const result = await verifyPayment();

    if (!result.status || result.data.status !== "success") {
      return res.status(400).json({
        success: false,
        error: { code: "PAYMENT_NOT_VERIFIED", message: "Payment could not be verified" },
      });
    }

    const { metadata } = result.data;

    // ===== IDOR GUARD: verify this payment belongs to the authenticated user =====
    // Without this check, User B could replay User A's Paystack reference to
    // upgrade their own account for free (business-logic IDOR).
    // The webhook stores userId in metadata at payment-initiation time; we verify it here.
    const paymentOwnerUserId = metadata?.userId;
    const customerEmail = result.data.customer?.email;
    const authenticatedUserEmail = req.user.email;

    const ownershipByUid =
      paymentOwnerUserId && paymentOwnerUserId.toString() === req.user.id.toString();
    const ownershipByEmail =
      customerEmail &&
      authenticatedUserEmail &&
      customerEmail.toLowerCase() === authenticatedUserEmail.toLowerCase();

    if (!ownershipByUid && !ownershipByEmail) {
      Logger.warn("Paystack verify IDOR attempt blocked", {
        requestingUserId: req.user.id,
        paymentOwnerUserId,
        customerEmail,
        reference: req.params.reference,
      });
      return res.status(403).json({
        success: false,
        error: {
          code: "PAYMENT_OWNERSHIP_MISMATCH",
          message: "This payment reference does not belong to your account",
        },
      });
    }

    const user = await User.findById(req.user.id);

    // If webhook hasn't processed yet, apply upgrade now
    // Read limits from live PricingConfig (admin-editable) → hardcoded fallback
    if (user && metadata?.tier && user.subscriptionTier !== metadata.tier) {
      const tierLimits = await User.getLiveTierLimits(metadata.tier);
      user.subscriptionTier = metadata.tier;
      user.subscriptionStatus = "active";
      user.subscriptionStartDate = new Date();
      user.limits = { ...tierLimits };

      const expiry = new Date();
      if (metadata.billingCycle === "yearly") {
        expiry.setFullYear(expiry.getFullYear() + 1);
      } else {
        expiry.setMonth(expiry.getMonth() + 1);
      }
      user.subscriptionExpiry = expiry;

      if (result.data.customer) {
        user.paystackCustomerId = result.data.customer.customer_code;
      }
      if (result.data.authorization) {
        user.paystackAuthorizationCode = result.data.authorization.authorization_code;
      }

      await user.save();
    }

    res.json({
      success: true,
      data: {
        verified: true,
        tier: metadata?.tier,
        billingCycle: metadata?.billingCycle,
        amount: result.data.amount,
        paidAt: result.data.paid_at,
        channel: result.data.channel,
      },
    });
  } catch (err) {
    Logger.error("Payment verification error", { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: "VERIFY_ERROR", message: "Failed to verify payment" },
    });
  }
});

// ===== GET SUBSCRIPTION PLANS (from admin-editable PricingConfig) =====
app.get("/api/plans", async (req, res) => {
  try {
    const PricingConfig = require("./models/PricingConfig");
    const config = await PricingConfig.getConfig();

    const plans = Object.entries(config.tiers).map(([tier, data]) => ({
      tier,
      name: data.name,
      description: data.description,
      pricing: {
        monthlyUSD: data.monthlyUSD,
        yearlyUSD: data.yearlyUSD,
        currency: "USD",
      },
      limits: data.limits,
      features: data.features,
    }));

    res.json({
      success: true,
      data: plans,
      exchangeRates: config.exchangeRates,
    });
  } catch (err) {
    Logger.error("Plans fetch error", { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to fetch plans" },
    });
  }
});

// ===== CANCEL SUBSCRIPTION =====
app.post("/api/user/cancel-subscription", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }

    if (user.subscriptionTier === "free") {
      return res.status(400).json({
        success: false,
        error: { code: "ALREADY_FREE", message: "You are already on the free plan" },
      });
    }

    // If user has a Paystack subscription, disable it
    if (user.paystackSubscriptionCode && process.env.PAYSTACK_SECRET_KEY) {
      try {
        const https = require("https");
        const disableSubscription = () =>
          new Promise((resolve, reject) => {
            const disableData = JSON.stringify({
              code: user.paystackSubscriptionCode,
              token: user.paystackAuthorizationCode,
            });

            const options = {
              hostname: "api.paystack.co",
              port: 443,
              path: "/subscription/disable",
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(disableData),
              },
            };

            const reqPaystack = https.request(options, (respPaystack) => {
              let data = "";
              respPaystack.on("data", (chunk) => (data += chunk));
              respPaystack.on("end", () => {
                try {
                  resolve(JSON.parse(data));
                } catch (e) {
                  reject(e);
                }
              });
            });
            reqPaystack.on("error", reject);
            reqPaystack.write(disableData);
            reqPaystack.end();
          });

        await disableSubscription();
        Logger.info("Paystack subscription disabled", {
          userId: user._id,
          code: user.paystackSubscriptionCode,
        });
      } catch (paystackErr) {
        Logger.warn("Failed to disable Paystack subscription", { error: paystackErr.message });
      }
    }

    // Keep current tier until expiry, mark as cancelled
    user.subscriptionStatus = "cancelled";
    await user.save();

    res.json({
      success: true,
      data: {
        message:
          "Subscription cancelled. You will retain access until your current billing period ends.",
        currentTier: user.subscriptionTier,
        expiresAt: user.subscriptionExpiry,
      },
    });
  } catch (err) {
    Logger.error("Cancel subscription error", { error: err.message });
    res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Failed to cancel subscription" },
    });
  }
});

const startServer = async () => {
  try {
    //   Connect to Redis
    try {
      await initializeRedis();
      Logger.info("  Redis Connected Successfully");
    } catch (redisErr) {
      Logger.warn("  Redis connection failed, rate limiting disabled", {
        error: redisErr.message,
      });
      Logger.warn("The server will continue to run but without Redis-based rate limiting");
    }

    // ===== L6 404 Attack Tracker (catches path scanning before 404 response) =====
    app.use(notFoundAttackTracker);

    // ===== Error Handler Middleware (MUST BE LAST) =====
    app.use(errorHandler);

    // Start Express server
    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
      Logger.info(` Server running on http://localhost:${PORT}`);
      Logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
      Logger.info("All security features enabled  ");
    });

    // ===== Global Server Timeouts =====
    server.timeout = 120000; // 2 min request timeout
    server.keepAliveTimeout = 65000; // 65s keep-alive (> typical LB 60s)
    server.headersTimeout = 70000; // 70s headers timeout (> keepAlive)

    // ===== Graceful Shutdown Handlers =====
    const gracefulShutdown = async (signal) => {
      Logger.info(`${signal} recieved - shutting down gracefuly`);

      try {
        if (server) {
          server.close(() => {
            Logger.info("HTTP server closed");
          });
        }
        await disconnect();

        try {
          await disconnectRedis();
          Logger.info("Redis disconnected");
        } catch (err) {
          Logger.error("Error disconnecting Redis", { message: err.message });
        }

        Logger.info("Shutdown complete");
        process.exit(0);
      } catch (err) {
        Logger.error(" Shutdown error", { error: err.message });
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    process.on("uncaughtException", (err) => {
      Logger.error("Uncaught Exceeption", {
        error: err.message,
        stack: err.stack,
      });
      process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
      Logger.error("Unhandled Rejection", {
        promise: String(promise),
        reason: String(reason),
      });
    });
    // ===== Handle Uncaught Exceptions =====
    process.on("uncaughtException", (err) => {
      Logger.error("Uncaught Exception", {
        message: err.message,
        stack: err.stack,
      });
      process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
      Logger.error("Unhandled Promise Rejection", { reason });
      process.exit(1);
    });
  } catch (err) {
    Logger.error("Failed to start server", { message: err.message });
    process.exit(1);
  }
};

// ===== Start Server =====
startServer();
