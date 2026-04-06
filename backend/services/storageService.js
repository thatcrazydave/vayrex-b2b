/**
 * storageService.js
 *
 * Unified file storage abstraction backed by Supabase Storage.
 * Replaces all direct AWS S3 calls in the B2B codebase.
 *
 * Every method accepts an orgId parameter so files are namespaced
 * per organisation:  orgs/{orgId}/...
 *
 * Usage:
 *   const storage = require('./services/storageService');
 *   const { publicUrl } = await storage.upload(buffer, 'notes/readme.pdf', 'application/pdf', orgId, userId);
 *   const signedUrl     = await storage.getSignedUrl('notes/readme.pdf', orgId);
 *   await storage.remove('notes/readme.pdf', orgId);
 */

"use strict";

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const Logger = require("../logger");

// ── Singleton client ─────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "vayrex-b2b-files";

let supabase = null;

function getClient() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error(
        "Supabase credentials missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env",
      );
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
  }
  return supabase;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the full storage path for a file inside the bucket.
 * Format: orgs/{orgId}/{relativePath}
 * If orgId is null (e.g. system-level backup), the path is used as-is.
 */
function buildPath(relativePath, orgId) {
  if (orgId) return `orgs/${orgId}/${relativePath}`;
  return relativePath;
}

/**
 * Generate a unique filename preserving the original extension.
 * Example: "report.pdf" -> "a4f7c2...b1e3.pdf"
 */
function uniqueName(originalName) {
  const ext = originalName.includes(".") ? originalName.split(".").pop() : "";
  const hash = crypto.randomBytes(16).toString("hex");
  return ext ? `${hash}.${ext}` : hash;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Upload a file buffer to Supabase Storage.
 *
 * @param {Buffer}  buffer       - File contents
 * @param {string}  relativePath - Path inside the org namespace (e.g. "uploads/report.pdf")
 * @param {string}  contentType  - MIME type ("application/pdf", "image/png", etc.)
 * @param {string}  orgId        - Organisation ObjectId (null for system files)
 * @param {string}  userId       - Uploading user's ObjectId (for metadata / audit)
 * @returns {{ path: string, publicUrl: string }}
 */
async function upload(buffer, relativePath, contentType, orgId, userId) {
  const client = getClient();
  const fullPath = buildPath(relativePath, orgId);

  const { data, error } = await client.storage.from(BUCKET).upload(fullPath, buffer, {
    contentType,
    upsert: false,
    duplex: "half",
    metadata: {
      orgId: orgId || "system",
      userId: userId || "system",
      uploadedAt: new Date().toISOString(),
    },
  });

  if (error) {
    Logger.error("Supabase upload failed", {
      path: fullPath,
      error: error.message,
      orgId,
    });
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  // Build public URL (works if bucket is public; for private buckets use getSignedUrl)
  const {
    data: { publicUrl },
  } = client.storage.from(BUCKET).getPublicUrl(fullPath);

  return { path: fullPath, publicUrl };
}

/**
 * Generate a time-limited signed download URL.
 *
 * @param {string} relativePath - Path inside the org namespace
 * @param {string} orgId        - Organisation ObjectId
 * @param {number} expiresIn    - Seconds until expiry (default 3600 = 1 hour)
 * @returns {string} Signed URL
 */
async function getSignedDownloadUrl(relativePath, orgId, expiresIn = 3600) {
  const client = getClient();
  const fullPath = buildPath(relativePath, orgId);

  const { data, error } = await client.storage
    .from(BUCKET)
    .createSignedUrl(fullPath, expiresIn);

  if (error) {
    Logger.error("Supabase signed URL failed", {
      path: fullPath,
      error: error.message,
    });
    throw new Error(`Signed URL generation failed: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Download a file and return its Buffer + metadata.
 *
 * @param {string} relativePath
 * @param {string} orgId
 * @returns {{ buffer: Buffer, contentType: string }}
 */
async function download(relativePath, orgId) {
  const client = getClient();
  const fullPath = buildPath(relativePath, orgId);

  const { data, error } = await client.storage.from(BUCKET).download(fullPath);

  if (error) {
    Logger.error("Supabase download failed", {
      path: fullPath,
      error: error.message,
    });
    throw new Error(`Storage download failed: ${error.message}`);
  }

  // data is a Blob in the browser but a ReadableStream / Buffer in Node
  const buffer = Buffer.from(await data.arrayBuffer());
  return { buffer, contentType: data.type };
}

/**
 * Delete a single file.
 *
 * @param {string} relativePath
 * @param {string} orgId
 */
async function remove(relativePath, orgId) {
  const client = getClient();
  const fullPath = buildPath(relativePath, orgId);

  const { error } = await client.storage.from(BUCKET).remove([fullPath]);

  if (error) {
    Logger.error("Supabase delete failed", {
      path: fullPath,
      error: error.message,
    });
    throw new Error(`Storage delete failed: ${error.message}`);
  }
}

/**
 * Delete multiple files at once.
 *
 * @param {string[]} relativePaths
 * @param {string}   orgId
 */
async function removeMany(relativePaths, orgId) {
  const client = getClient();
  const fullPaths = relativePaths.map((p) => buildPath(p, orgId));

  const { error } = await client.storage.from(BUCKET).remove(fullPaths);

  if (error) {
    Logger.error("Supabase bulk delete failed", {
      count: fullPaths.length,
      error: error.message,
    });
    throw new Error(`Bulk delete failed: ${error.message}`);
  }
}

/**
 * List files under a prefix (folder).
 *
 * @param {string} prefix - Folder path inside the org namespace (e.g. "uploads/")
 * @param {string} orgId
 * @param {object} options - { limit, offset, sortBy }
 * @returns {Array} File metadata objects
 */
async function list(prefix, orgId, options = {}) {
  const client = getClient();
  const fullPrefix = buildPath(prefix, orgId);

  const { data, error } = await client.storage.from(BUCKET).list(fullPrefix, {
    limit: options.limit || 100,
    offset: options.offset || 0,
    sortBy: options.sortBy || { column: "created_at", order: "desc" },
  });

  if (error) {
    Logger.error("Supabase list failed", {
      prefix: fullPrefix,
      error: error.message,
    });
    throw new Error(`Storage list failed: ${error.message}`);
  }

  return data;
}

/**
 * Move / rename a file within the same bucket.
 *
 * @param {string} fromPath - Current relative path
 * @param {string} toPath   - New relative path
 * @param {string} orgId
 */
async function move(fromPath, toPath, orgId) {
  const client = getClient();
  const fullFrom = buildPath(fromPath, orgId);
  const fullTo = buildPath(toPath, orgId);

  const { error } = await client.storage.from(BUCKET).move(fullFrom, fullTo);

  if (error) {
    Logger.error("Supabase move failed", {
      from: fullFrom,
      to: fullTo,
      error: error.message,
    });
    throw new Error(`Storage move failed: ${error.message}`);
  }
}

/**
 * Copy a file within the same bucket.
 *
 * @param {string} fromPath
 * @param {string} toPath
 * @param {string} orgId
 */
async function copy(fromPath, toPath, orgId) {
  const client = getClient();
  const fullFrom = buildPath(fromPath, orgId);
  const fullTo = buildPath(toPath, orgId);

  const { error } = await client.storage.from(BUCKET).copy(fullFrom, fullTo);

  if (error) {
    Logger.error("Supabase copy failed", {
      from: fullFrom,
      to: fullTo,
      error: error.message,
    });
    throw new Error(`Storage copy failed: ${error.message}`);
  }
}

module.exports = {
  upload,
  getSignedDownloadUrl,
  download,
  remove,
  removeMany,
  list,
  move,
  copy,
  uniqueName,
  buildPath,
  getClient,
  BUCKET,
};
