/// <reference path="../pb_data/types.d.ts" />

// Hooks for the `packages` collection. Targets PocketBase v0.23+ (v0.37.4).
//
// Helpers live in ./utils.js and are required() inside each callback because
// PB's JSVM does not share the file's top-level scope with hook callbacks.

onRecordCreateRequest((e) => {
  const {
    normalizeLanguageBranches,
    parseGithubName,
    validateGithubBranches,
  } = require(`${__hooks}/utils.js`);
  if (!e.auth) {
    throw new BadRequestError("must be signed in");
  }
  const url = e.record.getString("github_url");
  const name = parseGithubName(url);
  if (!name) {
    throw new BadRequestError(
      "github_url must be a public GitHub repo URL like https://github.com/owner/repo"
    );
  }
  const normalized = normalizeLanguageBranches(e.record.get("language_branches"));
  validateGithubBranches(name, normalized.languageBranches);
  e.record.set("name", name);
  e.record.set("language_branches", normalized.languageBranches);
  e.record.set("languages", normalized.languages);
  e.record.set("status", "pending");
  e.record.set("stars", 0);
  e.record.set("submitter", e.auth.id);
  e.next();
}, "packages");

onRecordAfterCreateSuccess((e) => {
  const { fetchGithubMeta, dispatchRebuild } = require(`${__hooks}/utils.js`);
  const meta = fetchGithubMeta(e.record.getString("name"));
  if (meta) {
    if (!e.record.getString("description") && meta.description) {
      e.record.set("description", meta.description);
    }
    e.record.set("stars", meta.stars);
    e.record.set("default_branch", meta.default_branch);
    if (meta.pushed_at) e.record.set("pushed_at", meta.pushed_at);
    if (meta.og_image) e.record.set("og_image", meta.og_image);
    try {
      e.app.save(e.record);
    } catch (err) {
      console.log("[packages] enrichment save failed: " + err);
    }
  }
  if (e.record.getString("status") === "approved") {
    dispatchRebuild("create:" + e.record.getString("name"));
  }
}, "packages");

onRecordUpdateRequest((e) => {
  const {
    isSuperuser,
    normalizeLanguageBranches,
    PROTECTED_FIELDS,
    validateGithubBranches,
  } = require(`${__hooks}/utils.js`);
  if (!isSuperuser(e.auth)) {
    const original = e.record.original();
    for (const field of PROTECTED_FIELDS) {
      e.record.set(field, original.get(field));
    }
  }
  const normalized = normalizeLanguageBranches(e.record.get("language_branches"));
  validateGithubBranches(e.record.getString("name"), normalized.languageBranches);
  e.record.set("language_branches", normalized.languageBranches);
  e.record.set("languages", normalized.languages);
  e.next();
}, "packages");

onRecordAfterUpdateSuccess((e) => {
  const { dispatchRebuild } = require(`${__hooks}/utils.js`);
  dispatchRebuild("update:" + e.record.getString("name"));
}, "packages");

onRecordAfterDeleteSuccess((e) => {
  const { dispatchRebuild } = require(`${__hooks}/utils.js`);
  if (e.record.getString("status") === "approved") {
    dispatchRebuild("delete:" + e.record.getString("name"));
  }
}, "packages");

cronAdd("packages-github-refresh", "0 3 * * *", () => {
  const { fetchGithubMeta, dispatchRebuild } = require(`${__hooks}/utils.js`);
  const records = $app.findRecordsByFilter(
    "packages",
    "status = 'approved'",
    "-pushed_at",
    0,
    0
  );
  let touched = 0;
  for (const rec of records) {
    const meta = fetchGithubMeta(rec.getString("name"));
    if (!meta) continue;
    rec.set("stars", meta.stars);
    if (meta.default_branch) rec.set("default_branch", meta.default_branch);
    if (meta.pushed_at) rec.set("pushed_at", meta.pushed_at);
    if (meta.og_image) rec.set("og_image", meta.og_image);
    try {
      $app.save(rec);
      touched++;
    } catch (err) {
      console.log(
        "[packages refresh] failed to save " + rec.getString("name") + ": " + err
      );
    }
  }
  console.log("[packages refresh] refreshed " + touched + " records");
  if (touched > 0) dispatchRebuild("nightly-refresh");
});
