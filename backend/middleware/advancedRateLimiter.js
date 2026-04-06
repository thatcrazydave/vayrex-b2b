/**
 * =====================================================================
 * ADVANCED 12-LAYER ADVERSARIAL RATE LIMITER — V2 (DOOMSDAY HARDENED)
 * =====================================================================
 *
 * Hardened specifically against:
 *  - V5-PORTABLE-DOOMSDAY: mass concurrent requests, XFF spoofing, proxy
 *    rotation, realistic UA rotation, mass signup floods, token harvesting,
 *    wildcard query bombs, bcrypt CPU exhaustion, keep-alive exhaustion
 *
 * KEY CHANGES FROM V1:
 *  - L1 burst threshold cut 4x (200→50), block time increased 3x
 *  - New global signup throttle (max 2 signups/IP/hour)
 *  - New global concurrent request cap per IP (max 8 simultaneous)
 *  - Missing Sec-Fetch-* headers = hard signal on ALL non-GET requests
 *  - XFF with no trusted proxy = auto-strip + flag
 *  - Query param abuse detection (limit>500 or wildcard *)
 *  - Cross-IP signup pattern detection (global signup velocity)
 *  - Request body hash dedup (same payload from multiple IPs = coordinated)
 *  - Tarpitting: blocked IPs get 5s delay instead of instant 429
 *
 * Insert BEFORE all other middleware in server.js.
 * =====================================================================
 */

const { isRedisReady, getRedisClient } = require("../redisClient");
const Logger = require("../logger");
const crypto = require("crypto");

// ========== CONFIGURATION (env-overridable, HARDENED DEFAULTS) ==========

const CONFIG = {
  // L1: IP Velocity Burst — HARDENED: 50 req/10s (was 200)
  L1_BURST_MAX: Number(process.env.L1_BURST_MAX) || 50,
  L1_BURST_WINDOW_S: Number(process.env.L1_BURST_WINDOW_S) || 10,
  L1_BLOCK_DURATION_S: Number(process.env.L1_BLOCK_DURATION_S) || 1800, // 30 min (was 10)

  // L2: Auth Brute-Force — HARDENED: 3 fails (was 5)
  L2_AUTH_MAX_FAILS: Number(process.env.L2_AUTH_MAX_FAILS) || 3,
  L2_AUTH_WINDOW_S: Number(process.env.L2_AUTH_WINDOW_S) || 900,
  L2_AUTH_BLOCK_S: Number(process.env.L2_AUTH_BLOCK_S) || 3600, // 1 hour (was 30min)

  // L3: Credential Stuffing — HARDENED: 2 accounts (was 3)
  L3_MAX_ACCOUNTS: Number(process.env.L3_MAX_ACCOUNTS) || 2,
  L3_WINDOW_S: Number(process.env.L3_WINDOW_S) || 300,
  L3_BLOCK_S: Number(process.env.L3_BLOCK_S) || 7200, // 2 hours (was 1)

  // L4: Bot / Scanner UA
  L4_BLOCK_S: Number(process.env.L4_BLOCK_S) || 86400,

  // L5: Payload Bloat — HARDENED: 30KB (was 50KB)
  L5_MAX_BODY_BYTES: Number(process.env.L5_MAX_BODY_BYTES) || 30720,

  // L6: Path / Dir Scan — HARDENED: 5 (was 10)
  L6_MAX_404S: Number(process.env.L6_MAX_404S) || 5,
  L6_WINDOW_S: Number(process.env.L6_WINDOW_S) || 300,
  L6_BLOCK_S: Number(process.env.L6_BLOCK_S) || 3600, // 1 hour (was 30min)

  // L7: Slow Loris — HARDENED: 3 concurrent (was 5)
  L7_MAX_CONCURRENT: Number(process.env.L7_MAX_CONCURRENT) || 3,
  L7_BLOCK_S: Number(process.env.L7_BLOCK_S) || 1800, // 30 min (was 15)

  // L8: IP Blocklist + Tor Exit
  L8_BLOCKLIST_KEY: "attack:ip_blocklist",
  L8_TOR_KEY: "attack:tor_exit_nodes",

  // L9: Reverse Proxy / Header Spoofing — HARDENED: 2 hops (was 3)
  L9_MAX_FORWARDED_HOPS: Number(process.env.L9_MAX_FORWARDED_HOPS) || 2,
  L9_BLOCK_S: Number(process.env.L9_BLOCK_S) || 7200, // 2 hours (was 1)

  // L10: Distributed Crawler Fingerprint — HARDENED: 15 req/min (was 30)
  L10_VELOCITY_THRESHOLD: Number(process.env.L10_VELOCITY_THRESHOLD) || 15,
  L10_SCORE_THRESHOLD: Number(process.env.L10_SCORE_THRESHOLD) || 2, // was 3
  L10_BLOCK_S: Number(process.env.L10_BLOCK_S) || 3600,

  // L11: Rapid Endpoint Cycling — HARDENED: 8 endpoints (was 15)
  L11_MAX_DISTINCT_ENDPOINTS: Number(process.env.L11_MAX_DISTINCT_ENDPOINTS) || 8,
  L11_WINDOW_S: Number(process.env.L11_WINDOW_S) || 30,
  L11_BLOCK_S: Number(process.env.L11_BLOCK_S) || 7200,

  // L12: Honeypot Trap
  L12_BLOCK_S: Number(process.env.L12_BLOCK_S) || 86400,

  // === NEW: DOOMSDAY-SPECIFIC HARDENING ===

  // Signup flood per IP (max signups per hour from single IP)
  SIGNUP_MAX_PER_IP: Number(process.env.SIGNUP_MAX_PER_IP) || 2,
  SIGNUP_WINDOW_S: Number(process.env.SIGNUP_WINDOW_S) || 3600,
  SIGNUP_BLOCK_S: Number(process.env.SIGNUP_BLOCK_S) || 86400, // 24 hours

  // Global signup velocity (across ALL IPs — catches distributed signup floods)
  GLOBAL_SIGNUP_MAX_PER_MIN: Number(process.env.GLOBAL_SIGNUP_MAX_PER_MIN) || 10,
  GLOBAL_SIGNUP_COOLDOWN_S: Number(process.env.GLOBAL_SIGNUP_COOLDOWN_S) || 30, // pause signups for 30s

  // Concurrent request cap per IP
  CONCURRENT_REQ_MAX: Number(process.env.CONCURRENT_REQ_MAX) || 8,

  // Query param abuse (wildcard / mega-limit)
  QUERY_MAX_LIMIT: Number(process.env.QUERY_MAX_LIMIT) || 500,

  // Request body dedup (catches same payload from distributed proxies)
  BODY_DEDUP_WINDOW_S: Number(process.env.BODY_DEDUP_WINDOW_S) || 60,
  BODY_DEDUP_MAX: Number(process.env.BODY_DEDUP_MAX) || 3, // same body hash max 3x/min
  BODY_DEDUP_BLOCK_S: Number(process.env.BODY_DEDUP_BLOCK_S) || 3600,

  // Tarpit delay for blocked IPs (ms) — wastes attacker's curl connections
  TARPIT_DELAY_MS: Number(process.env.TARPIT_DELAY_MS) || 5000,

  // Progressive block escalation multiplier
  BLOCK_ESCALATION_MULTIPLIER: Number(process.env.BLOCK_ESCALATION_MULTIPLIER) || 2,
};

// ========== KNOWN BOT/SCANNER USER-AGENTS (L4) ==========

const BOT_UA_PATTERNS = [
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /burp\s?suite/i,
  /owasp/i,
  /masscan/i,
  /dirbuster/i,
  /gobuster/i,
  /wfuzz/i,
  /ffuf/i,
  /hydra/i,
  /metasploit/i,
  /nessus/i,
  /openvas/i,
  /acunetix/i,
  /w3af/i,
  /zap\/?/i,
  /nuclei/i,
  /gospider/i,
  /subfinder/i,
  /amass/i,
  /whatweb/i,
  /wafw00f/i,
  /scrapy/i,
  /python-requests\/\d/i,
  /python-urllib/i,
  /curl\/\d/i,
  /wget/i,
  /libwww-perl/i,
  /java\/\d/i,
  /httpclient/i,
  /go-http-client/i,
  /axios\/\d/i,
  /node-fetch/i,
  /aiohttp/i,
  /httpx/i,
  /zgrab/i,
  /censys/i,
  /shodan/i,
  /internet\s?measurement/i,
];

// ========== HONEYPOT ROUTES (L12) ==========

const HONEYPOT_PATHS = [
  "/.env",
  "/.git",
  "/.git/config",
  "/.gitignore",
  "/wp-admin",
  "/wp-login",
  "/wp-login.php",
  "/wp-config.php",
  "/phpmyadmin",
  "/admin/config",
  "/api/v0/",
  "/api/internal/",
  "/api/admin/debug",
  "/api/admin/shell",
  "/api/debug",
  "/config.json",
  "/server.js",
  "/package.json",
  "/.DS_Store",
  "/etc/passwd",
  "/api/graphql",
  "/api/swagger",
  "/api/docs",
  "/actuator",
  "/actuator/health",
  "/debug/vars",
  "/trace",
  "/api/__debug",
  // V5-DOOMSDAY specific: wildcard query patterns
  "/api/v2/", // Script targets /api/v2/* which doesn't exist on Vayrex
];

// ========== UPLOAD ROUTE PREFIXES (excluded from L5 body-size check) ==========

const UPLOAD_ROUTE_PREFIXES = [
  "/api/upload",
  "/api/ai/generate-from-notes",
  "/api/ai/summarize",
  "/api/ai/course-outline",
  "/api/ai/parse-image",
  "/api/export/pdf",
  "/api/paystack/webhook",
];

// ========== AUTH ROUTE PREFIXES (for L2 & L3) ==========

const AUTH_ROUTES = [
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/firebase-login",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
];

const SIGNUP_ROUTES = ["/api/auth/signup"];

// ========== IN-MEMORY STORES ==========

const _ipBurstStore = new Map();
const _authFailStore = new Map();
const _credStuffStore = new Map();
const _404Store = new Map();
const _connCountStore = new Map();
const _endpointCycleStore = new Map();
const _ipBlockStore = new Map();
const _crawlerStore = new Map();
const _signupStore = new Map(); // NEW: per-IP signup count
const _globalSignupStore = { count: 0, resetAt: 0 }; // NEW: global signup velocity
const _concurrentStore = new Map(); // NEW: per-IP concurrent requests
const _bodyHashStore = new Map(); // NEW: body hash dedup
const _blockEscalation = new Map(); // NEW: progressive block escalation

// Periodic cleanup (every 30s — was 60s)
let _lastCleanup = Date.now();
function cleanupStores() {
  const now = Date.now();
  if (now - _lastCleanup < 30000) return;
  _lastCleanup = now;

  const stores = [
    _ipBurstStore,
    _authFailStore,
    _credStuffStore,
    _404Store,
    _connCountStore,
    _endpointCycleStore,
    _ipBlockStore,
    _crawlerStore,
    _signupStore,
    _bodyHashStore,
    _blockEscalation,
  ];
  for (const store of stores) {
    for (const [key, data] of store.entries()) {
      if (data.expiresAt && now > data.expiresAt) store.delete(key);
    }
    if (store.size > 50000) {
      const keys = Array.from(store.keys()).slice(0, 5000);
      keys.forEach((k) => store.delete(k));
    }
  }
  // Reset global signup counter
  if (now > _globalSignupStore.resetAt) {
    _globalSignupStore.count = 0;
    _globalSignupStore.resetAt = now + 60000;
  }
}

// ========== HELPERS ==========

function getSocketIP(req) {
  return req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown";
}

/**
 * Normalize IP to prevent ::ffff:127.0.0.1 vs ::1 vs 127.0.0.1 mismatches.
 * Node.js returns different formats depending on IPv4/IPv6 connection type.
 */
function normalizeIP(ip) {
  if (!ip) return "unknown";
  // Strip IPv4-mapped IPv6 prefix
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  // Normalize all localhost variants to a single value
  if (ip === "::1" || ip === "127.0.0.1" || ip === "localhost") return "127.0.0.1";
  return ip;
}

function getClientIP(req) {
  const raw =
    req.ip && req.ip !== "::1" && req.ip !== "127.0.0.1" && req.ip !== "::ffff:127.0.0.1"
      ? req.ip
      : getSocketIP(req);
  return normalizeIP(raw);
}

function normalizePath(p) {
  return (
    (p || "/").split("?")[0].toLowerCase().replace(/\/+$/, "").replace(/\/+/g, "/") || "/"
  );
}

async function isIPBlocked(ip) {
  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      const blocked = await redis.get(`attack:blocked:${ip}`);
      if (blocked) return JSON.parse(blocked);
    } catch (_) {}
  }
  const entry = _ipBlockStore.get(ip);
  if (entry && Date.now() < entry.expiresAt) return entry;
  if (entry) _ipBlockStore.delete(ip);
  return null;
}

async function blockIP(ip, durationSeconds, layerCode, reason) {
  // Progressive escalation: each subsequent block doubles the duration
  const escKey = `esc:${ip}`;
  const escalation = _blockEscalation.get(escKey);
  let multiplier = 1;
  if (escalation && Date.now() < escalation.expiresAt) {
    multiplier = Math.min(escalation.level * CONFIG.BLOCK_ESCALATION_MULTIPLIER, 32); // Cap at 32x
    escalation.level++;
  } else {
    _blockEscalation.set(escKey, {
      level: 2,
      expiresAt: Date.now() + 86400 * 1000, // Track for 24h
    });
  }

  const actualDuration = durationSeconds * multiplier;
  const expiresAt = Date.now() + actualDuration * 1000;
  const data = {
    layerCode,
    reason,
    blockedAt: Date.now(),
    expiresAt,
    escalationLevel: multiplier,
  };

  Logger.error(`[ATTACK] ${layerCode} - IP blocked`, {
    ip,
    reason,
    durationMinutes: Math.ceil(actualDuration / 60),
    layerCode,
    escalation: `${multiplier}x`,
  });

  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      await redis.setEx(`attack:blocked:${ip}`, actualDuration, JSON.stringify(data));
    } catch (_) {}
  }
  _ipBlockStore.set(ip, { ...data });
}

async function redisIncr(key, windowSeconds) {
  if (!isRedisReady()) return null;
  try {
    const redis = getRedisClient();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count;
  } catch (_) {
    return null;
  }
}

async function redisZAdd(key, value, windowSeconds) {
  if (!isRedisReady()) return null;
  try {
    const redis = getRedisClient();
    const now = Date.now();
    await redis.zRemRangeByScore(key, 0, now - windowSeconds * 1000);
    await redis.zAdd(key, { score: now, value: `${value}:${now}` });
    await redis.expire(key, windowSeconds * 2);
    return await redis.zCard(key);
  } catch (_) {
    return null;
  }
}

async function redisSAdd(key, member, windowSeconds) {
  if (!isRedisReady()) return null;
  try {
    const redis = getRedisClient();
    await redis.sAdd(key, member);
    await redis.expire(key, windowSeconds);
    return await redis.sCard(key);
  } catch (_) {
    return null;
  }
}

function memoryIncr(store, key, windowMs) {
  cleanupStores();
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now > entry.expiresAt) {
    store.set(key, { count: 1, expiresAt: now + windowMs });
    return 1;
  }
  entry.count++;
  return entry.count;
}

function memorySetAdd(store, key, member, windowMs) {
  cleanupStores();
  const now = Date.now();
  let entry = store.get(key);
  if (!entry || now > entry.expiresAt) {
    entry = { members: new Set(), expiresAt: now + windowMs };
    store.set(key, entry);
  }
  entry.members.add(member);
  return entry.members.size;
}

// ========== REJECT HELPER (with optional TARPIT) ==========

function rejectAttack(res, layerCode, retryAfterSeconds, tarpit = false) {
  // IMPORTANT: tarpit=false by default — respond immediately with 429.
  // Only use tarpit=true for already-blocked IPs (global block check)
  // so the first detection is instant and prevents Express from continuing.
  if (res.headersSent) return; // Guard against racing responses

  const sendReject = () => {
    if (res.headersSent) return;
    res.setHeader("Retry-After", retryAfterSeconds);
    return res.status(429).json({
      success: false,
      error: { code: "RATE_LIMITED", message: "Request blocked" },
    });
  };

  if (tarpit && CONFIG.TARPIT_DELAY_MS > 0) {
    // TARPIT: Hold the connection open, wasting attacker's curl thread
    // Only used for repeat offenders who hit the global block check
    return setTimeout(sendReject, CONFIG.TARPIT_DELAY_MS);
  }
  return sendReject();
}

// ========================================================================
//                           THE 12 LAYERS (HARDENED)
// ========================================================================

// L1: IP Velocity Burst — HARDENED: 50 req/10s (catches DOOMSDAY's jittered floods)
async function checkL1_BurstFlood(ip) {
  const key = `attack:l1:${ip}`;
  let count = await redisZAdd(
    key,
    crypto.randomBytes(4).toString("hex"),
    CONFIG.L1_BURST_WINDOW_S,
  );
  if (count === null) count = memoryIncr(_ipBurstStore, key, CONFIG.L1_BURST_WINDOW_S * 1000);
  if (count > CONFIG.L1_BURST_MAX) {
    await blockIP(
      ip,
      CONFIG.L1_BLOCK_DURATION_S,
      "ATTACK_L1_IP_BURST",
      `${count} requests in ${CONFIG.L1_BURST_WINDOW_S}s`,
    );
    return true;
  }
  return false;
}

// L2: Auth Brute-Force — HARDENED: 3 fails/15min
async function checkL2_AuthBruteForce(ip) {
  const key = `attack:l2:${ip}`;
  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      const count = await redis.get(key);
      if (count && parseInt(count) >= CONFIG.L2_AUTH_MAX_FAILS) {
        await blockIP(
          ip,
          CONFIG.L2_AUTH_BLOCK_S,
          "ATTACK_L2_AUTH_BRUTE",
          `${count} failed auth attempts`,
        );
        return true;
      }
    } catch (_) {}
  }
  const entry = _authFailStore.get(key);
  if (entry && Date.now() < entry.expiresAt && entry.count >= CONFIG.L2_AUTH_MAX_FAILS) {
    await blockIP(
      ip,
      CONFIG.L2_AUTH_BLOCK_S,
      "ATTACK_L2_AUTH_BRUTE",
      `${entry.count} failed auth attempts`,
    );
    return true;
  }
  return false;
}

// Called from auth routes on login failure — feeds L2 + L3
async function recordAuthFailure(ip, accountIdentifier) {
  const l2Key = `attack:l2:${ip}`;
  if (isRedisReady()) {
    try {
      await redisIncr(l2Key, CONFIG.L2_AUTH_WINDOW_S);
    } catch (_) {}
  }
  memoryIncr(_authFailStore, l2Key, CONFIG.L2_AUTH_WINDOW_S * 1000);

  const l3Key = `attack:l3:${ip}`;
  let uniqueAccounts;
  if (isRedisReady()) {
    uniqueAccounts = await redisSAdd(l3Key, accountIdentifier, CONFIG.L3_WINDOW_S);
  }
  if (uniqueAccounts === null || uniqueAccounts === undefined) {
    uniqueAccounts = memorySetAdd(
      _credStuffStore,
      l3Key,
      accountIdentifier,
      CONFIG.L3_WINDOW_S * 1000,
    );
  }
  if (uniqueAccounts >= CONFIG.L3_MAX_ACCOUNTS) {
    await blockIP(
      ip,
      CONFIG.L3_BLOCK_S,
      "ATTACK_L3_CRED_STUFF",
      `${uniqueAccounts} distinct accounts tried from same IP`,
    );
  }
}

// L4: Bot / Scanner UA
function checkL4_BotUA(req) {
  const ua = req.headers["user-agent"] || "";
  if (!ua || ua.length < 5) return false;
  for (const pattern of BOT_UA_PATTERNS) {
    if (pattern.test(ua)) return true;
  }
  return false;
}

// L5: Payload Bloat — HARDENED: 30KB
function checkL5_PayloadBloat(req) {
  const contentLength = parseInt(req.headers["content-length"] || "0");
  const path = normalizePath(req.path);
  for (const prefix of UPLOAD_ROUTE_PREFIXES) {
    if (path.startsWith(prefix)) return false;
  }
  return contentLength > CONFIG.L5_MAX_BODY_BYTES;
}

// L6: Path / Directory Scanning — HARDENED: 5 404s
async function recordAndCheckL6_PathScan(ip) {
  const key = `attack:l6:${ip}`;
  let count = await redisIncr(key, CONFIG.L6_WINDOW_S);
  if (count === null) count = memoryIncr(_404Store, key, CONFIG.L6_WINDOW_S * 1000);
  if (count >= CONFIG.L6_MAX_404S) {
    await blockIP(ip, CONFIG.L6_BLOCK_S, "ATTACK_L6_PATH_SCAN", `${count} 404 responses`);
    return true;
  }
  return false;
}

// L7: Slow Loris — HARDENED: 3 concurrent connections
function checkL7_SlowLoris(ip) {
  const entry = _connCountStore.get(ip);
  return entry ? entry.count >= CONFIG.L7_MAX_CONCURRENT : false;
}

function trackConnectionOpen(ip) {
  const entry = _connCountStore.get(ip) || { count: 0, expiresAt: Date.now() + 300000 };
  entry.count++;
  _connCountStore.set(ip, entry);
}

function trackConnectionClose(ip) {
  const entry = _connCountStore.get(ip);
  if (entry) {
    entry.count = Math.max(0, entry.count - 1);
    if (entry.count === 0) _connCountStore.delete(ip);
  }
}

// L8: IP Blocklist + Tor Exit Nodes
async function checkL8_Blocklist(ip) {
  if (!isRedisReady()) return false;
  try {
    const redis = getRedisClient();
    const isBlocked = await redis.sIsMember(CONFIG.L8_BLOCKLIST_KEY, ip);
    if (isBlocked) return true;
    const isTor = await redis.sIsMember(CONFIG.L8_TOR_KEY, ip);
    return isTor;
  } catch (_) {
    return false;
  }
}

// L9: Reverse Proxy / Header Spoofing — HARDENED: 2 hops, strips untrusted XFF
function checkL9_HeaderSpoof(req) {
  const xff = req.headers["x-forwarded-for"];
  const trustedProxies = (process.env.TRUSTED_PROXIES || "").split(",").filter(Boolean);

  // If XFF exists and no trusted proxies configured → always suspicious
  if (xff && trustedProxies.length === 0) {
    const hops = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (hops.length > CONFIG.L9_MAX_FORWARDED_HOPS) {
      Logger.warn("[L9] Suspicious XFF chain (no trusted proxies)", {
        xff,
        hops: hops.length,
        socketIP: getSocketIP(req),
      });
      delete req.headers["x-forwarded-for"];
      delete req.headers["x-real-ip"];
      return true;
    }
  }

  // Check if X-Real-IP/Client-IP is spoofed (doesn't match socket IP)
  const xRealIP = req.headers["x-real-ip"] || req.headers["client-ip"];
  if (xRealIP && trustedProxies.length === 0) {
    const socketIP = getSocketIP(req);
    // If the claimed IP doesn't match the actual socket IP → spoofing
    if (xRealIP !== socketIP) {
      Logger.warn("[L9] Spoofed X-Real-IP/Client-IP", {
        claimed: xRealIP,
        actual: socketIP,
      });
      delete req.headers["x-forwarded-for"];
      delete req.headers["x-real-ip"];
      delete req.headers["client-ip"];
      return true;
    }
  }

  return false;
}

// L10: Distributed Crawler Fingerprint — HARDENED: score 2, velocity 15/min
async function checkL10_CrawlerFingerprint(req, ip) {
  let score = 0;
  const headers = req.headers;

  // Signal 1: No Accept-Language (all browsers send this)
  if (!headers["accept-language"]) score++;

  // Signal 2: Missing Sec-Fetch-* (modern browsers ALWAYS send these on fetch/XHR)
  if (!headers["sec-fetch-site"] && !headers["sec-fetch-mode"] && !headers["sec-fetch-dest"]) {
    score++;
  }

  // Signal 3: No Referer AND no Origin on protected routes
  const path = normalizePath(req.path);
  const isProtected =
    path.startsWith("/api/user/") ||
    path.startsWith("/api/ai/") ||
    path.startsWith("/api/upload/") ||
    path.startsWith("/api/admin/");
  if (isProtected && !headers["referer"] && !headers["origin"]) score++;

  // Signal 4: Accept header is exactly "*/*" (browsers send specific types)
  if (headers["accept"] === "*/*") score++;

  if (score >= CONFIG.L10_SCORE_THRESHOLD) {
    const velKey = `attack:l10:vel:${ip}`;
    let velocity = await redisZAdd(velKey, crypto.randomBytes(4).toString("hex"), 60);
    if (velocity === null) velocity = memoryIncr(_crawlerStore, velKey, 60000);

    if (velocity >= CONFIG.L10_VELOCITY_THRESHOLD) {
      await blockIP(
        ip,
        CONFIG.L10_BLOCK_S,
        "ATTACK_L10_CRAWLER",
        `Crawler score ${score}/4, velocity ${velocity}/min`,
      );
      return true;
    }
  }
  return false;
}

// L11: Rapid Endpoint Cycling — HARDENED: 8 endpoints/30s
async function checkL11_EndpointCycling(req, ip) {
  const path = normalizePath(req.path)
    .replace(/\/[a-f0-9]{24}/g, "/:id")
    .replace(/\/[a-f0-9-]{36}/g, "/:uuid");

  const key = `attack:l11:${ip}`;
  let distinctCount;
  if (isRedisReady()) distinctCount = await redisSAdd(key, path, CONFIG.L11_WINDOW_S);
  if (distinctCount === null || distinctCount === undefined) {
    distinctCount = memorySetAdd(_endpointCycleStore, key, path, CONFIG.L11_WINDOW_S * 1000);
  }

  if (distinctCount >= CONFIG.L11_MAX_DISTINCT_ENDPOINTS) {
    await blockIP(
      ip,
      CONFIG.L11_BLOCK_S,
      "ATTACK_L11_API_RECON",
      `${distinctCount} distinct endpoints in ${CONFIG.L11_WINDOW_S}s`,
    );
    return true;
  }
  return false;
}

// L12: Honeypot Trap
function checkL12_Honeypot(req) {
  const path = normalizePath(req.path);
  for (const trap of HONEYPOT_PATHS) {
    if (path === trap || path.startsWith(trap)) return true;
  }
  return false;
}

// ========================================================================
//              NEW DOOMSDAY-SPECIFIC LAYERS
// ========================================================================

/**
 * SIGNUP FLOOD PROTECTION
 * Catches: V5-DOOMSDAY's 50% signup traffic pattern
 * - Max 2 signups per IP per hour
 * - Global signup velocity cap (10 signups/min across ALL IPs)
 */
async function checkSignupFlood(req, ip) {
  const path = normalizePath(req.path);
  const isSignup = SIGNUP_ROUTES.some((r) => path.startsWith(r));
  if (!isSignup || req.method !== "POST") return false;

  // Per-IP signup limit
  const ipKey = `attack:signup:${ip}`;
  let ipCount = await redisIncr(ipKey, CONFIG.SIGNUP_WINDOW_S);
  if (ipCount === null)
    ipCount = memoryIncr(_signupStore, ipKey, CONFIG.SIGNUP_WINDOW_S * 1000);

  if (ipCount > CONFIG.SIGNUP_MAX_PER_IP) {
    await blockIP(
      ip,
      CONFIG.SIGNUP_BLOCK_S,
      "ATTACK_SIGNUP_FLOOD",
      `${ipCount} signups from same IP in ${CONFIG.SIGNUP_WINDOW_S / 3600}h`,
    );
    return true;
  }

  // Global signup velocity check (catches distributed proxy attacks)
  const now = Date.now();
  if (now > _globalSignupStore.resetAt) {
    _globalSignupStore.count = 0;
    _globalSignupStore.resetAt = now + 60000;
  }
  _globalSignupStore.count++;

  if (_globalSignupStore.count > CONFIG.GLOBAL_SIGNUP_MAX_PER_MIN) {
    Logger.error("[ATTACK] Global signup velocity exceeded", {
      count: _globalSignupStore.count,
      limit: CONFIG.GLOBAL_SIGNUP_MAX_PER_MIN,
      ip,
    });
    // Don't block IP (could be distributed), but throttle by delaying
    return "throttle";
  }

  return false;
}

/**
 * CONCURRENT REQUEST CAP
 * Catches: V5-DOOMSDAY's 100+ concurrent workers
 * Max 8 simultaneous requests from same IP
 */
function checkConcurrentCap(ip) {
  const entry = _concurrentStore.get(ip) || 0;
  return entry >= CONFIG.CONCURRENT_REQ_MAX;
}

function trackConcurrentOpen(ip) {
  const current = _concurrentStore.get(ip) || 0;
  _concurrentStore.set(ip, current + 1);
}

function trackConcurrentClose(ip) {
  const current = _concurrentStore.get(ip) || 0;
  if (current <= 1) _concurrentStore.delete(ip);
  else _concurrentStore.set(ip, current - 1);
}

/**
 * QUERY PARAMETER ABUSE DETECTION
 * Catches: V5-DOOMSDAY's ?limit=99999999&department=* wildcard bombs
 */
function checkQueryAbuse(req, ip) {
  const query = req.query || {};

  // Check for wildcard values
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      // Block wildcard * in query params
      if (value === "*" || value.includes("*")) {
        Logger.warn("[QUERY_ABUSE] Wildcard in query param", { ip, key, value });
        return "wildcard";
      }
      // Block absurdly high limit/page values
      if (
        (key === "limit" || key === "pageSize" || key === "per_page" || key === "count") &&
        parseInt(value) > CONFIG.QUERY_MAX_LIMIT
      ) {
        Logger.warn("[QUERY_ABUSE] Excessive limit param", { ip, key, value });
        return "excessive_limit";
      }
      // Block negative pagination
      if ((key === "page" || key === "offset" || key === "skip") && parseInt(value) < 0) {
        Logger.warn("[QUERY_ABUSE] Negative pagination", { ip, key, value });
        return "negative_page";
      }
    }
  }
  return false;
}

/**
 * REQUEST BODY HASH DEDUPLICATION
 * Catches: V5-DOOMSDAY sending the same signup payload from many proxy IPs
 * If the same body hash appears >3 times in 60s (across ANY IPs), block.
 */
async function checkBodyDedup(req, ip) {
  // Only check POST requests with body
  if (req.method !== "POST" || !req.body || typeof req.body !== "object") return false;

  const path = normalizePath(req.path);
  // Only check auth routes (signup is the primary target)
  if (!AUTH_ROUTES.some((r) => path.startsWith(r))) return false;

  // Hash the body content
  const bodyStr = JSON.stringify(req.body);
  const bodyHash = crypto.createHash("sha256").update(bodyStr).digest("hex").substring(0, 16);

  const key = `attack:bodydup:${bodyHash}`;
  let count = await redisIncr(key, CONFIG.BODY_DEDUP_WINDOW_S);
  if (count === null)
    count = memoryIncr(_bodyHashStore, key, CONFIG.BODY_DEDUP_WINDOW_S * 1000);

  if (count > CONFIG.BODY_DEDUP_MAX) {
    await blockIP(
      ip,
      CONFIG.BODY_DEDUP_BLOCK_S,
      "ATTACK_BODY_DEDUP",
      `Same request body seen ${count} times in ${CONFIG.BODY_DEDUP_WINDOW_S}s`,
    );
    return true;
  }
  return false;
}

/**
 * MISSING SEC-FETCH HEADERS ON MUTATING REQUESTS
 * Real browsers ALWAYS send Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest
 * on POST/PUT/DELETE requests made via fetch() or XMLHttpRequest.
 * V5-DOOMSDAY uses curl which NEVER sends these.
 *
 * This is a hard signal: if a POST request to an API route is missing
 * ALL Sec-Fetch-* headers AND the request velocity is >5/min, block.
 */
async function checkMissingSecFetchOnMutation(req, ip) {
  // Only check mutating methods on API routes
  if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") return false;

  const path = normalizePath(req.path);
  if (!path.startsWith("/api/")) return false;

  // Skip webhook (external service)
  if (path.startsWith("/api/paystack/webhook")) return false;

  const hasSecFetch =
    req.headers["sec-fetch-site"] ||
    req.headers["sec-fetch-mode"] ||
    req.headers["sec-fetch-dest"];

  if (!hasSecFetch) {
    // Track velocity of non-browser POST requests from this IP
    const key = `attack:nosecfetch:${ip}`;
    let velocity = await redisIncr(key, 60);
    if (velocity === null) velocity = memoryIncr(_crawlerStore, `nosecfetch:${ip}`, 60000);

    // Allow up to 5 per minute (could be legit API calls from mobile app)
    if (velocity > 5) {
      await blockIP(
        ip,
        CONFIG.L10_BLOCK_S,
        "ATTACK_NO_SEC_FETCH",
        `${velocity} POST requests without Sec-Fetch-* headers in 1 min`,
      );
      return true;
    }
  }
  return false;
}

// ========================================================================
//                         MAIN MIDDLEWARE (HARDENED)
// ========================================================================

const advancedAttackLimiter = async (req, res, next) => {
  try {
    const ip = getClientIP(req);
    const path = normalizePath(req.path);

    // ---- GLOBAL BLOCK CHECK (with TARPIT for repeat offenders) ----
    const existingBlock = await isIPBlocked(ip);
    if (existingBlock) {
      const retryAfter = Math.ceil((existingBlock.expiresAt - Date.now()) / 1000);
      if (retryAfter > 0) {
        // TARPIT=true here: already-blocked IPs get delayed to waste their threads
        return rejectAttack(res, existingBlock.layerCode, retryAfter, true);
      }
    }

    // ---- CONCURRENT REQUEST CAP ----
    // SECURITY FIX: Increment BEFORE check to prevent race condition
    trackConcurrentOpen(ip);
    if (checkConcurrentCap(ip)) {
      trackConcurrentClose(ip); // Undo increment since we're rejecting
      Logger.warn("[CONCURRENT] Too many simultaneous requests", { ip, path });
      return rejectAttack(res, "ATTACK_CONCURRENT_CAP", 10, true);
    }

    // Track concurrent (decrement on close)
    res.on("close", () => {
      trackConcurrentClose(ip);
      trackConnectionClose(ip);
    });

    // ---- L12: Honeypot (instant block, no computation) ----
    if (checkL12_Honeypot(req)) {
      await blockIP(ip, CONFIG.L12_BLOCK_S, "ATTACK_L12_HONEYPOT", `Honeypot path: ${path}`);
      return rejectAttack(res, "ATTACK_L12_HONEYPOT", CONFIG.L12_BLOCK_S);
    }

    // ---- L8: IP Blocklist + Tor ----
    if (await checkL8_Blocklist(ip)) {
      await blockIP(ip, 86400, "ATTACK_L8_BLOCKLIST", "IP in blocklist or Tor");
      return rejectAttack(res, "ATTACK_L8_BLOCKLIST", 86400);
    }

    // ---- L4: Bot / Scanner UA ----
    if (checkL4_BotUA(req)) {
      await blockIP(
        ip,
        CONFIG.L4_BLOCK_S,
        "ATTACK_L4_BOT_UA",
        `Bot UA: ${(req.headers["user-agent"] || "").substring(0, 80)}`,
      );
      return rejectAttack(res, "ATTACK_L4_BOT_UA", CONFIG.L4_BLOCK_S);
    }

    // ---- L9: Header Spoofing (strips + blocks) ----
    if (checkL9_HeaderSpoof(req)) {
      await blockIP(
        ip,
        CONFIG.L9_BLOCK_S,
        "ATTACK_L9_HEADER_SPOOF",
        "Suspicious X-Forwarded-For/X-Real-IP",
      );
      return rejectAttack(res, "ATTACK_L9_HEADER_SPOOF", CONFIG.L9_BLOCK_S);
    }

    // ---- QUERY PARAM ABUSE (catches ?limit=99999999&department=*) ----
    const queryAbuse = checkQueryAbuse(req, ip);
    if (queryAbuse) {
      await blockIP(ip, 3600, "ATTACK_QUERY_ABUSE", `Query param abuse: ${queryAbuse}`);
      return rejectAttack(res, "ATTACK_QUERY_ABUSE", 3600);
    }

    // ---- L5: Payload Bloat ----
    if (checkL5_PayloadBloat(req)) {
      return res.status(413).json({
        success: false,
        error: { code: "RATE_LIMITED", message: "Request blocked" },
      });
    }

    // ---- L7: Slow Loris ----
    if (checkL7_SlowLoris(ip)) {
      await blockIP(
        ip,
        CONFIG.L7_BLOCK_S,
        "ATTACK_L7_SLOW_LORIS",
        `${_connCountStore.get(ip)?.count || "many"} concurrent connections`,
      );
      return rejectAttack(res, "ATTACK_L7_SLOW_LORIS", CONFIG.L7_BLOCK_S);
    }

    // ---- L1: IP Velocity Burst ----
    if (await checkL1_BurstFlood(ip)) {
      return rejectAttack(res, "ATTACK_L1_IP_BURST", CONFIG.L1_BLOCK_DURATION_S);
    }

    // ---- L2: Auth Brute-Force ----
    const isAuthRoute = AUTH_ROUTES.some((r) => path.startsWith(r));
    if (isAuthRoute && (await checkL2_AuthBruteForce(ip))) {
      return rejectAttack(res, "ATTACK_L2_AUTH_BRUTE", CONFIG.L2_AUTH_BLOCK_S);
    }

    // ---- SIGNUP FLOOD (per-IP + global velocity) ----
    const signupResult = await checkSignupFlood(req, ip);
    if (signupResult === true) {
      return rejectAttack(res, "ATTACK_SIGNUP_FLOOD", CONFIG.SIGNUP_BLOCK_S);
    }
    if (signupResult === "throttle") {
      // Global signup velocity exceeded — delay this request by 30s
      return setTimeout(() => {
        if (!res.headersSent) {
          res.status(429).json({
            success: false,
            error: { code: "RATE_LIMITED", message: "Request blocked" },
          });
        }
      }, CONFIG.GLOBAL_SIGNUP_COOLDOWN_S * 1000);
    }

    // ---- MISSING SEC-FETCH ON MUTATIONS ----
    if (await checkMissingSecFetchOnMutation(req, ip)) {
      return rejectAttack(res, "ATTACK_NO_SEC_FETCH", CONFIG.L10_BLOCK_S);
    }

    // ---- L10: Crawler Fingerprint ----
    if (await checkL10_CrawlerFingerprint(req, ip)) {
      return rejectAttack(res, "ATTACK_L10_CRAWLER", CONFIG.L10_BLOCK_S);
    }

    // ---- L11: Endpoint Cycling ----
    if (await checkL11_EndpointCycling(req, ip)) {
      return rejectAttack(res, "ATTACK_L11_API_RECON", CONFIG.L11_BLOCK_S);
    }

    // ---- REQUEST BODY DEDUP (catches coordinated proxy attacks) ----
    if (await checkBodyDedup(req, ip)) {
      return rejectAttack(res, "ATTACK_BODY_DEDUP", CONFIG.BODY_DEDUP_BLOCK_S);
    }

    // Failsafe: if ANY layer already sent a response, don't call next()
    if (res.headersSent) return;

    // Track connection for L7
    trackConnectionOpen(ip);

    next();
  } catch (err) {
    Logger.error("[ATTACK_LIMITER] Critical error", {
      error: err.message,
      stack: err.stack,
    });
    // Fail closed
    return res.status(503).json({
      success: false,
      error: { code: "SERVICE_UNAVAILABLE", message: "Request blocked" },
    });
  }
};

// ========================================================================
//              L6 HOOK — 404 handler
// ========================================================================

const notFoundAttackTracker = async (req, res, next) => {
  const ip = getClientIP(req);

  // Skip L6 tracking for localhost in development — legitimate 404s during
  // dev (new routes, testing) should not trigger IP blocks.
  if (process.env.NODE_ENV !== "production" && ip === "127.0.0.1") {
    return next();
  }

  const blocked = await recordAndCheckL6_PathScan(ip);
  if (blocked) {
    return rejectAttack(res, "ATTACK_L6_PATH_SCAN", CONFIG.L6_BLOCK_S);
  }
  next();
};

// ========================================================================
//               ADMIN UTILITIES
// ========================================================================

async function addToBlocklist(ip) {
  if (!isRedisReady()) return false;
  try {
    const redis = getRedisClient();
    await redis.sAdd(CONFIG.L8_BLOCKLIST_KEY, ip);
    Logger.info("[ADMIN] IP added to blocklist", { ip });
    return true;
  } catch (_) {
    return false;
  }
}

async function removeFromBlocklist(ip) {
  if (!isRedisReady()) return false;
  try {
    const redis = getRedisClient();
    await redis.sRem(CONFIG.L8_BLOCKLIST_KEY, ip);
    await redis.del(`attack:blocked:${ip}`);
    _ipBlockStore.delete(ip);
    Logger.info("[ADMIN] IP removed from blocklist", { ip });
    return true;
  } catch (_) {
    return false;
  }
}

async function unblockIP(ip) {
  if (isRedisReady()) {
    try {
      const redis = getRedisClient();
      await redis.del(`attack:blocked:${ip}`);
    } catch (_) {}
  }
  _ipBlockStore.delete(ip);
  _blockEscalation.delete(`esc:${ip}`);
  Logger.info("[ADMIN] IP manually unblocked", { ip });
}

// Get attack statistics
function getAttackStats() {
  return {
    blockedIPs: _ipBlockStore.size,
    activeConnections: Array.from(_connCountStore.entries()).reduce(
      (sum, [, v]) => sum + v.count,
      0,
    ),
    concurrentRequests: Array.from(_concurrentStore.entries()).reduce(
      (sum, [, v]) => sum + v,
      0,
    ),
    globalSignupsThisMinute: _globalSignupStore.count,
    escalatedIPs: _blockEscalation.size,
    storesSizes: {
      burst: _ipBurstStore.size,
      authFail: _authFailStore.size,
      credStuff: _credStuffStore.size,
      pathScan: _404Store.size,
      crawler: _crawlerStore.size,
      signups: _signupStore.size,
      bodyDedup: _bodyHashStore.size,
    },
  };
}

module.exports = {
  advancedAttackLimiter,
  notFoundAttackTracker,
  recordAuthFailure,
  addToBlocklist,
  removeFromBlocklist,
  unblockIP,
  getAttackStats,
  CONFIG,
};
