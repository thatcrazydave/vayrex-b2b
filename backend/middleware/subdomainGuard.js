/**
 * subdomainGuard.js
 *
 * Layer 1 of org isolation: extracts the subdomain from the request Host header,
 * resolves it to an Organization, and cross-validates it against the JWT's
 * organizationId claim.
 *
 * A token issued for School A CANNOT access School B — the subdomain mismatch
 * will reject the request before any route handler runs.
 *
 * Usage:
 *   Apply AFTER authenticateToken on all org-scoped routes.
 *   app.use('/api/org', authenticateToken, subdomainGuard, router);
 *
 * The resolved org document is attached to req.org for downstream use.
 */

const Organization = require("../models/Organization");
const Logger = require("../logger");

// In-process cache: subdomain → { orgId, org } with 5-minute TTL
// Avoids a DB lookup on every request for active orgs
const CACHE_TTL_MS = 5 * 60 * 1000;
const subdomainCache = new Map(); // { subdomain: { orgId, org, cachedAt } }

function getCachedOrg(subdomain) {
  const entry = subdomainCache.get(subdomain);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    subdomainCache.delete(subdomain);
    return null;
  }
  return entry;
}

function setCachedOrg(subdomain, org) {
  subdomainCache.set(subdomain, { orgId: org._id.toString(), org, cachedAt: Date.now() });
}

/**
 * extractSubdomain — pulls the first label from the Host header.
 * e.g. "lagosgrammar.madebyovo.me" → "lagosgrammar"
 * Returns null for bare domains (madebyovo.me, localhost, IP addresses).
 */
function extractSubdomain(host) {
  if (!host) return null;
  // Strip port if present
  const hostname = host.split(":")[0];
  const parts = hostname.split(".");
  // Bare domain or localhost — no subdomain
  if (parts.length <= 2) return null;
  const sub = parts[0].toLowerCase();
  // Reject "www" as a valid org subdomain
  if (sub === "www") return null;
  return sub;
}

/**
 * subdomainGuard middleware
 *
 * Requires authenticateToken to have run first (req.user must exist).
 * - If request has no subdomain: passes through (B2C flow, no org context)
 * - If subdomain present:
 *   1. Resolves org from DB (or cache)
 *   2. Cross-validates JWT's organizationId matches the resolved org
 *   3. Sets req.org and req.subdomain
 */
const subdomainGuard = async (req, res, next) => {
  try {
    const subdomain = extractSubdomain(req.headers.host || req.hostname);

    if (!subdomain) {
      // No subdomain — B2C request, not subject to org guard
      req.subdomain = null;
      req.org = null;
      return next();
    }

    req.subdomain = subdomain;

    // Resolve org (cache-first)
    let orgEntry = getCachedOrg(subdomain);
    if (!orgEntry) {
      const org = await Organization.findBySubdomain(subdomain);
      if (!org) {
        Logger.warn("Subdomain not found", {
          subdomain,
          ip: req.ip,
          path: req.path,
        });
        return res.status(404).json({
          success: false,
          error: {
            code: "ORG_NOT_FOUND",
            message: "Organization not found",
            timestamp: new Date().toISOString(),
          },
        });
      }
      setCachedOrg(subdomain, org);
      orgEntry = getCachedOrg(subdomain);
    }

    req.org = orgEntry.org;

    // If the user is not authenticated (public routes), skip cross-validation
    if (!req.user) return next();

    // Cross-validate: JWT orgId must match the org resolved from the subdomain
    const jwtOrgId = req.user.organizationId ? req.user.organizationId.toString() : null;

    if (!jwtOrgId) {
      Logger.warn("B2C token used on org subdomain", {
        subdomain,
        userId: req.user._id,
        ip: req.ip,
        path: req.path,
      });
      return res.status(403).json({
        success: false,
        error: {
          code: "NOT_ORG_MEMBER",
          message: "Your account is not associated with this organisation",
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (jwtOrgId !== orgEntry.orgId) {
      Logger.warn("Cross-org token use detected", {
        subdomain,
        tokenOrgId: jwtOrgId,
        resolvedOrgId: orgEntry.orgId,
        userId: req.user._id,
        ip: req.ip,
      });
      return res.status(403).json({
        success: false,
        error: {
          code: "ORG_MISMATCH",
          message: "Token is not valid for this organisation",
          timestamp: new Date().toISOString(),
        },
      });
    }

    next();
  } catch (err) {
    Logger.error("subdomainGuard error", { error: err.message, stack: err.stack });
    return res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Authentication error" },
    });
  }
};

/**
 * Invalidate a specific subdomain's cache entry.
 * Call this after org settings change (slug updates, deactivation, etc.)
 */
subdomainGuard.invalidateCache = function (subdomain) {
  subdomainCache.delete(subdomain.toLowerCase());
};

module.exports = subdomainGuard;
