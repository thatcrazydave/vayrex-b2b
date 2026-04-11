/**
 * orgScopedQuery — helpers that enforce orgId filtering + .lean() on every query.
 * Use these instead of raw Model.find() in org-scoped route handlers.
 */

function orgFind(Model, orgId, filter = {}, projection = null) {
  if (!orgId) throw new Error("orgScopedQuery: orgId is required");
  const query = Model.find({ ...filter, orgId });
  if (projection) query.select(projection);
  return query.lean();
}

function orgFindOne(Model, orgId, filter = {}, projection = null) {
  if (!orgId) throw new Error("orgScopedQuery: orgId is required");
  const query = Model.findOne({ ...filter, orgId });
  if (projection) query.select(projection);
  return query.lean();
}

function orgCountDocuments(Model, orgId, filter = {}) {
  if (!orgId) throw new Error("orgScopedQuery: orgId is required");
  return Model.countDocuments({ ...filter, orgId });
}

/**
 * Variant for User model which uses organizationId instead of orgId.
 */
function userFind(orgId, filter = {}, projection = null) {
  const User = require("../models/User");
  if (!orgId) throw new Error("orgScopedQuery: orgId is required");
  const query = User.find({ ...filter, organizationId: orgId });
  if (projection) query.select(projection);
  return query.lean();
}

module.exports = { orgFind, orgFindOne, orgCountDocuments, userFind };
