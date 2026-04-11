"use strict";

/**
 * provisioningService.js
 *
 * Automatically provisions infrastructure when a school goes live:
 *   1. Netlify — adds the school's subdomain as a domain alias on the site
 *   2. DNS    — adds the CNAME record at the DNS provider
 *              (currently Cloudflare; stub is ready for any provider)
 *
 * Called fire-and-forget from POST /api/onboarding/org/setup-complete.
 * Errors are logged but never bubble up to the school's response.
 */

const https = require("https");
const Logger = require("../logger");

// ── Netlify ───────────────────────────────────────────────────────────────────

const NETLIFY_TOKEN   = process.env.NETLIFY_ACCESS_TOKEN;
const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID;
const NETLIFY_API     = "api.netlify.com";

/**
 * Low-level helper: JSON request to Netlify REST API.
 */
function netlifyRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: NETLIFY_API,
      path,
      method,
      headers: {
        Authorization: `Bearer ${NETLIFY_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "Vayrex-B2B/1.0",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Add `domain` as a domain alias on the Netlify site.
 * Fetches existing aliases first so we don't overwrite them.
 */
async function addNetlifyDomainAlias(domain) {
  if (!NETLIFY_TOKEN || !NETLIFY_SITE_ID) {
    Logger.warn("[PROVISIONING] Netlify credentials not configured — skipping domain alias", { domain });
    return { skipped: true };
  }

  // 1. Fetch current site config to get existing aliases
  const siteRes = await netlifyRequest("GET", `/api/v1/sites/${NETLIFY_SITE_ID}`);
  if (siteRes.status !== 200) {
    throw new Error(`Netlify GET site failed: ${siteRes.status} — ${JSON.stringify(siteRes.body)}`);
  }

  const existingAliases = Array.isArray(siteRes.body.domain_aliases)
    ? siteRes.body.domain_aliases
    : [];

  Logger.info("[PROVISIONING] Netlify current domain aliases", { existingAliases });

  // 2. Skip if already present
  if (existingAliases.includes(domain)) {
    Logger.info("[PROVISIONING] Netlify alias already exists — skipping", { domain });
    return { alreadyExists: true };
  }

  // 3. Patch site with new alias appended
  const updatedAliases = [...existingAliases, domain];
  const patchRes = await netlifyRequest("PATCH", `/api/v1/sites/${NETLIFY_SITE_ID}`, {
    domain_aliases: updatedAliases,
  });

  if (patchRes.status !== 200) {
    throw new Error(`Netlify PATCH site failed: ${patchRes.status} — ${JSON.stringify(patchRes.body)}`);
  }

  Logger.info("[PROVISIONING] Netlify domain alias added successfully", {
    domain,
    allAliases: patchRes.body.domain_aliases,
  });

  return { added: true, domain };
}

// ── Cloudflare DNS ────────────────────────────────────────────────────────────
// To enable: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID in .env
// Get them from: Cloudflare dashboard → your domain → Overview (Zone ID) +
//   My Profile → API Tokens → Create Token (DNS:Edit permission)
//
// To switch to Cloudflare DNS:
//   1. In Namecheap: change nameservers to the two Cloudflare NS records
//   2. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID in backend/.env
//   3. That's it — everything below is already wired up

const CF_TOKEN   = process.env.CLOUDFLARE_API_TOKEN;
const CF_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const CF_API     = "api.cloudflare.com";

function cloudflareRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: CF_API,
      path,
      method,
      headers: {
        Authorization: `Bearer ${CF_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "Vayrex-B2B/1.0",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Add a CNAME record: {slug}.madebyovo.me → {netlifyTarget}
 */
async function addCloudflareCNAME(slug, netlifyTarget) {
  if (!CF_TOKEN || !CF_ZONE_ID) {
    Logger.warn("[PROVISIONING] Cloudflare credentials not configured — skipping DNS record", { slug });
    return { skipped: true, reason: "CLOUDFLARE_NOT_CONFIGURED" };
  }

  // Check if record already exists
  const listRes = await cloudflareRequest(
    "GET",
    `/client/v4/zones/${CF_ZONE_ID}/dns_records?type=CNAME&name=${slug}.madebyovo.me`,
  );
  if (listRes.status !== 200) {
    throw new Error(`Cloudflare list DNS records failed: ${listRes.status} — ${JSON.stringify(listRes.body)}`);
  }

  const existing = listRes.body.result || [];
  if (existing.length > 0) {
    Logger.info("[PROVISIONING] Cloudflare CNAME already exists — skipping", { slug });
    return { alreadyExists: true };
  }

  // Create CNAME record
  const createRes = await cloudflareRequest(
    "POST",
    `/client/v4/zones/${CF_ZONE_ID}/dns_records`,
    {
      type: "CNAME",
      name: slug,                // "emilio" → Cloudflare resolves relative to zone (madebyovo.me)
      content: netlifyTarget,    // "schools-vayrex.netlify.app"
      ttl: 1,                    // 1 = automatic
      proxied: false,            // proxied = true enables Cloudflare CDN/SSL; set true once confirmed working
    },
  );

  if (createRes.status !== 200) {
    throw new Error(`Cloudflare create CNAME failed: ${createRes.status} — ${JSON.stringify(createRes.body)}`);
  }

  Logger.info("[PROVISIONING] Cloudflare CNAME created", {
    slug,
    recordId: createRes.body.result?.id,
    name: createRes.body.result?.name,
    content: createRes.body.result?.content,
  });

  return { created: true, recordId: createRes.body.result?.id };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Provision DNS + Netlify alias for a newly-live school.
 * Both steps are attempted independently — one failing doesn't skip the other.
 * Returns a summary of what succeeded/failed.
 */
async function provisionSchoolSubdomain({ slug, subdomain }) {
  const netlifyTarget = (process.env.NETLIFY_SITE_URL || "schools-vayrex.netlify.app")
    .replace(/^https?:\/\//, "");

  const results = { netlify: null, dns: null };

  // ── Netlify alias ──────────────────────────────────────────────────────────
  try {
    results.netlify = await addNetlifyDomainAlias(subdomain);
    Logger.info("[PROVISIONING] Netlify step complete", { subdomain, result: results.netlify });
  } catch (err) {
    results.netlify = { error: err.message };
    Logger.error("[PROVISIONING] Netlify step FAILED", { subdomain, error: err.message });
  }

  // ── DNS (Cloudflare when configured; Namecheap stays manual until switched) ─
  try {
    results.dns = await addCloudflareCNAME(slug, netlifyTarget);
    Logger.info("[PROVISIONING] DNS step complete", { slug, result: results.dns });
  } catch (err) {
    results.dns = { error: err.message };
    Logger.error("[PROVISIONING] DNS step FAILED", { slug, error: err.message });
  }

  return results;
}

module.exports = { provisionSchoolSubdomain };
