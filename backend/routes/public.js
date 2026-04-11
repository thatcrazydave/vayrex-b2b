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
    // Prefer the ?host query param sent by the frontend (the actual browser hostname),
    // because req.headers.host is the API server's host (e.g. ngrok URL) when the
    // frontend and backend are on different domains.
    const rawHost = (req.query.host || req.headers.host || req.hostname || "").trim().toLowerCase();
    const sourceHeader = req.query.host ? "?host param" : "Host header";

    // extractSubdomain returns null for bare domains (madebyovo.me) and non-subdomain hosts (ngrok)
    const subdomain = subdomainGuard.extractSubdomain(rawHost);

    // [TEMP LOG] ─────────────────────────────────────────────────────────────
    Logger.info("[TENANT-DEBUG] org-by-host called", {
      rawHost,
      source: sourceHeader,
      extractedSubdomain: subdomain,
      reqHostHeader: req.headers.host,
      queryHost: req.query.host || null,
    });
    // ─────────────────────────────────────────────────────────────────────────

    // No subdomain → platform marketing host; tell frontend to show platform shell
    if (!subdomain) {
      Logger.info("[TENANT-DEBUG] org-by-host → no subdomain, returning org: null", { rawHost });
      return res.json({ success: true, org: null });
    }

    // Cache key: use rawHost (e.g. "emilio.madebyovo.me") for accuracy
    const cacheKey = rawHost;

    // Cache hit
    const cached = getCached(cacheKey);
    if (cached) {
      Logger.info("[TENANT-DEBUG] org-by-host → cache HIT", { cacheKey, orgName: cached.name });
      return res.json({ success: true, org: cached });
    }

    // DB lookup — org.subdomain stores the full domain ("emilio.madebyovo.me")
    // Fall back to slug ("emilio") for forward-compat with any future format changes
    const BASE = process.env.BASE_DOMAIN || "madebyovo.me";
    const fullDomain = subdomain.includes(".") ? subdomain : `${subdomain}.${BASE}`;

    Logger.info("[TENANT-DEBUG] org-by-host → DB lookup", {
      queries: [rawHost, fullDomain, subdomain],
    });

    const org = await Organization.findOne({
      $or: [
        { subdomain: rawHost },       // "emilio.madebyovo.me" — matches current DB format
        { subdomain: fullDomain },    // same, built from extracted slug
        { subdomain: subdomain },     // "emilio" — future-proof if format ever changes
        { slug: subdomain },          // slug fallback
      ],
      isActive: true,
    }).lean();

    if (!org) {
      Logger.warn("[TENANT-DEBUG] org-by-host → DB lookup MISS — org not found or inactive", {
        rawHost, subdomain, fullDomain,
      });
      return res.json({ success: true, org: null });
    }

    Logger.info("[TENANT-DEBUG] org-by-host → org FOUND", {
      orgId: org._id,
      name: org.name,
      storedSubdomain: org.subdomain,
      isActive: org.isActive,
      setupComplete: org.setupComplete,
    });

    const data = publicOrgShape(org);
    setCache(cacheKey, data);

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
