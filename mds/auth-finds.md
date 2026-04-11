# Auth System Audit Findings

Full audit of the B2B auth flow, middleware pipeline, and security posture.
Findings are grouped by severity. Each item includes the file, line numbers, the problem, and a recommended fix.

---

## CRITICAL — Password & Credential Logging

These issues cause plaintext passwords, tokens, and other credentials to appear in terminal output and/or log files.

### C1. Sanitizer middleware logs raw request body (including passwords)

**File:** `B2B/backend/middleware/sanitizer.js` — lines 307-312

```js
// Log original for debugging (remove in production)
if (process.env.NODE_ENV !== 'production') {
  Logger.debug('Sanitizing request body', {
    path: req.path,
    originalBody: JSON.stringify(req.body)  // <-- FULL BODY WITH PASSWORD
  });
}
```

**Impact:** Every POST to `/api/auth/signup`, `/api/auth/login`, `/api/auth/forgot-password`, `/api/onboarding/org/register`, etc. prints the raw password, confirmPassword, and inviteToken to the terminal in development/staging.

**Fix:** Remove the `originalBody` field entirely, or redact sensitive fields before logging:

```js
if (process.env.NODE_ENV !== 'production') {
  Logger.debug('Sanitizing request body', {
    path: req.path,
    fields: Object.keys(req.body),  // log field NAMES only, never values
  });
}
```

---

### C2. Sanitizer logs raw body again on error path

**File:** `B2B/backend/middleware/sanitizer.js` — lines 334-338

```js
Logger.error('Request body sanitization failed', {
  path: req.path,
  error: err.message,
  body: JSON.stringify(req.body)  // <-- FULL BODY WITH PASSWORD
});
```

**Impact:** This is `Logger.error()` — it writes to `logs/error.log` immediately (not just console). Passwords end up on disk even in production.

**Fix:** Replace `body: JSON.stringify(req.body)` with `fields: Object.keys(req.body)`.

---

### C3. Input validator logs raw body on validation failure

**File:** `B2B/backend/middleware/inputValidator.js` — lines 138-142

```js
Logger.warn("Input validation failed", {
  path: req.path,
  errors,
  body: JSON.stringify(req.body),  // <-- FULL BODY WITH PASSWORD
});
```

**Impact:** `Logger.warn()` writes to the error.log buffer and flushes to disk. Any malformed signup/login request logs the password to disk.

**Fix:** Remove the `body` field. The `errors` array already tells you what failed. If field values are needed for debugging, redact sensitive ones:

```js
Logger.warn("Input validation failed", {
  path: req.path,
  errors,
  fields: Object.keys(req.body),
});
```

---

## HIGH — Incomplete Sanitization

### H1. Audit logger sanitizeBody() misses sensitive fields

**File:** `B2B/backend/middleware/auditLogger.js` — lines 38-43

```js
function sanitizeBody(body) {
  const sanitized = { ...body };
  delete sanitized.password;
  delete sanitized.token;
  return sanitized;  // confirmPassword, inviteToken, currentPassword, resetCode still present
}
```

**Impact:** Audit log entries (stored in MongoDB `AuditLog` collection) may contain `confirmPassword`, `inviteToken`, `currentPassword`, `resetCode`, and `verificationCode`.

**Fix:** Use a comprehensive redaction list:

```js
const SENSITIVE_FIELDS = [
  'password', 'confirmPassword', 'currentPassword', 'newPassword',
  'token', 'inviteToken', 'resetToken', 'verificationToken',
  'resetCode', 'verificationCode', 'accessToken', 'refreshToken',
];

function sanitizeBody(body) {
  const sanitized = { ...body };
  for (const field of SENSITIVE_FIELDS) {
    delete sanitized[field];
  }
  return sanitized;
}
```

Apply the same list to `sanitizeResponse()` on line 45.

---

### H2. Logger utility has no built-in field redaction

**File:** `B2B/backend/logger.js` — line 52

```js
const formatLog = (level, message, data = null) => {
  let entry = `[${getTimestamp()}] [${level}] ${message}`;
  if (data) entry += ` | ${JSON.stringify(data)}`;  // raw stringify, no filtering
  return entry;
};
```

**Impact:** Any caller that passes sensitive data in the `data` object will have it logged verbatim. This is the root cause of C1-C3 — no safety net at the logger level.

**Fix:** Add a redaction pass inside `formatLog`:

```js
const REDACTED_KEYS = new Set([
  'password', 'confirmPassword', 'currentPassword', 'newPassword',
  'token', 'inviteToken', 'resetToken', 'accessToken', 'refreshToken',
  'originalBody', 'body',  // catch-all for serialized body dumps
  'resetCode', 'verificationCode',
]);

function redactSensitive(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitive(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const formatLog = (level, message, data = null) => {
  let entry = `[${getTimestamp()}] [${level}] ${message}`;
  if (data) entry += ` | ${JSON.stringify(redactSensitive(data))}`;
  return entry;
};
```

This is a defense-in-depth measure — even if a developer accidentally passes `req.body` to a Logger call, passwords will be redacted.

---

## MEDIUM — Infrastructure & Token Security

### M1. Token revocation fails open when Redis is down

**File:** `B2B/backend/services/tokenService.js` — lines ~119-120

When Redis is unavailable, `isTokenRevoked()` returns `false`, meaning previously revoked tokens will be accepted.

**Fix:** Either fail closed (reject all requests if Redis is down) or maintain an in-memory revocation cache that syncs with Redis. For a school platform, fail-closed is safer:

```js
async isTokenRevoked(jti) {
  try {
    const revoked = await redis.get(`revoked:${jti}`);
    return !!revoked;
  } catch (err) {
    Logger.error('Redis unavailable for token revocation check', { jti });
    return true;  // fail closed — reject token if we can't verify
  }
}
```

---

### M2. CORS whitelist includes development URLs

**File:** `B2B/backend/server.js` — CORS_ORIGINS env variable

Current whitelist includes `http://localhost:5173`, `http://192.168.0.199:5173`, and ngrok URLs. These should be stripped for production deployment.

**Fix:** Use environment-specific CORS origins. Only include `https://madebyovo.me` and `https://*.madebyovo.me` in production.

---

## LOW — Minor Hardening

### L1. Timing side-channel on password reset

**File:** `B2B/backend/routes/auth.js` — lines ~843-851

The forgot-password endpoint returns a generic message regardless of whether the email exists. However, a timing attack could distinguish existing vs non-existing emails based on response time (DB lookup happens only for existing emails).

**Note:** The response hardening middleware (`responseHardening.js`) already adds a 300ms minimum response time for auth endpoints, which partially mitigates this. Verify it covers `/api/auth/forgot-password`.

---

### L2. Password hashing location

**File:** `B2B/backend/models/User.js` — lines ~294-315 (pre-save hook)

Password hashing is done in the Mongoose pre-save hook, which is fine architecturally. The schema already has `select: false` on the password field and a `toJSON()` override that strips it. The double-hash detection (bcrypt pattern check) is a good safeguard.

The real exposure isn't about WHERE hashing happens — it's about the logging middleware (C1-C3) running before the route handler ever touches the password. Fixing the logging issues above eliminates the exposure.

---

## ALREADY FIXED (this session)

These were found and patched in the current session:

### F1. Signup.jsx navigate(null) redirect bug

**File:** `B2B/src/components/Signup.jsx` — lines 29, 33-37

The `useEffect` that redirects already-authenticated users called `navigate(getDashboardRoute(null))`. Since `user` wasn't passed, `getDashboardRoute(null)` returned `null`, and `navigate(null)` resolved to path `"/null"` — hitting the catch-all route which redirected to `/org-signup`.

**Fixed:** Destructured `user` from `useAuth()` and changed the effect to only redirect when `user.tenantSubdomain` is set.

### F2. PlatformRoutes swallowed /verify-email for authenticated users

**File:** `B2B/src/App.jsx` — line 91

The platform-host auth redirect only had an exception for `/org-setup`. Authenticated users clicking the email verification link were redirected to their tenant subdomain (losing the token).

**Fixed:** Added `/verify-email`, `/forgot-password`, `/reset-password` to the exception list via `AUTH_PAGES` array.

### F3. /forgot-password and /reset-password missing from PlatformRoutes

**File:** `B2B/src/App.jsx`

These routes existed in `TenantRoutes` but not in `PlatformRoutes`. Since the password reset email links to `${FRONTEND_URL}/reset-password?token=...` (the platform host), clicking the link hit the catch-all and redirected to `/org-signup`.

**Fixed:** Added both routes to `PlatformRoutes`.

---

## Summary

| ID  | Severity | Component | Issue | Disk Exposure |
|-----|----------|-----------|-------|---------------|
| C1  | CRITICAL | sanitizer.js:309 | Logs raw body (DEBUG) | Console only (dev) |
| C2  | CRITICAL | sanitizer.js:337 | Logs raw body (ERROR) | error.log (all envs) |
| C3  | CRITICAL | inputValidator.js:141 | Logs raw body (WARN) | error.log (all envs) |
| H1  | HIGH | auditLogger.js:38 | Incomplete field redaction | MongoDB AuditLog |
| H2  | HIGH | logger.js:52 | No built-in redaction | All log outputs |
| M1  | MEDIUM | tokenService.js:119 | Redis fail-open on revocation | N/A |
| M2  | MEDIUM | server.js CORS | Dev URLs in whitelist | N/A |
| L1  | LOW | auth.js:843 | Timing side-channel (partially mitigated) | N/A |
| F1  | FIXED | Signup.jsx:33 | navigate(null) → /org-signup | N/A |
| F2  | FIXED | App.jsx:91 | /verify-email swallowed by auth redirect | N/A |
| F3  | FIXED | App.jsx routes | /forgot-password, /reset-password missing | N/A |

### Recommended implementation order

1. **C2 + C3 first** — these write passwords to disk in ALL environments
2. **H2 (logger redaction)** — defense-in-depth, prevents future regressions
3. **C1** — lower priority since it's dev-only console output, but still fix it
4. **H1** — audit log sanitization
5. **M1, M2, L1** — infrastructure hardening, do before production launch
