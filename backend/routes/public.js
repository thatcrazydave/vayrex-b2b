/**
 * public.js
 *
 * Unauthenticated routes used by the frontend to resolve tenant context
 * from the current hostname before any login occurs.
 *
 * GET /api/public/org-by-host
 *   → Returns a safe subset of the Organization document for the subdomain
 *     inferred from the request's Host header.
 *   → Returns { org: null } for bare-domain (platform) requests.
 *
 * No auth middleware on this router — it must be mounted BEFORE
 * authenticateToken in server.js.
 */

const express = require("express");
const router = express.Router();
const Organization = require("../models/Organization");
const subdomainGuard = require("../middleware/subdomainGuard");
const Logger = require("../logger");

// In-process cache mirroring subdomainGuard's: subdomain → { data, cachedAt }
const CACHE_TTL_MS = 5 * 60 * 1000;
const publicCache = new Map();

function getCached(subdomain) {
  const entry = publicCache.get(subdomain);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    publicCache.delete(subdomain);
    return null;
  }
  return entry.data;
}

function setCache(subdomain, data) {
  publicCache.set(subdomain, { data, cachedAt: Date.now() });
}

/**
 * Invalidate a specific subdomain's public cache entry.
 * Call from branding-update handlers so the frontend sees changes immediately.
 */
router.invalidateCache = function (subdomain) {
  publicCache.delete(subdomain.toLowerCase());
};

// Safe fields returned to unauthenticated callers
function publicOrgShape(org) {
  return {
    id:           org._id,
    name:         org.name,
    slug:         org.slug,
    subdomain:    org.subdomain,
    setupComplete: org.setupComplete,
    branding: {
      logoUrl:            org.branding?.logoUrl    ?? null,
      faviconUrl:         org.branding?.faviconUrl ?? null,
      primaryColor:       org.branding?.primaryColor  ?? "#2563eb",
      accentColor:        org.branding?.accentColor   ?? "#10b981",
      displayName:        org.branding?.displayName   ?? null,
      tagline:            org.branding?.tagline        ?? null,
      loginHeroText:      org.branding?.loginHeroText  ?? null,
      hideVayrexBranding: org.branding?.hideVayrexBranding ?? false,
    },
  };
}

router.get("/org-by-host", async (req, res) => {
  try {
    const subdomain = subdomainGuard.extractSubdomain(
      req.headers.host || req.hostname
    );

    // No subdomain → platform marketing host; tell frontend to show platform shell
    if (!subdomain) {
      return res.json({ success: true, org: null });
    }

    // Cache hit
    const cached = getCached(subdomain);
    if (cached) {
      return res.json({ success: true, org: cached });
    }

    // DB lookup
    const org = await Organization.findOne({
      subdomain: subdomain.toLowerCase(),
      isActive: true,
    }).lean();

    if (!org) {
      // Unknown subdomain — return null so frontend falls back gracefully
      return res.json({ success: true, org: null });
    }

    const data = publicOrgShape(org);
    setCache(subdomain, data);

    return res.json({ success: true, org: data });
  } catch (err) {
    Logger.error("public/org-by-host error", { error: err.message });
    return res.status(500).json({
      success: false,
      error: { code: "SERVER_ERROR", message: "Could not resolve tenant" },
    });
  }
});

module.exports = router;
