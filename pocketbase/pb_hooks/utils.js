// Helpers for the packages hooks. Imported via require() inside each hook
// callback because PB's JSVM does not share top-level scope with callbacks.

const PROTECTED_FIELDS = [
  "github_url",
  "name",
  "submitter",
  "status",
  "stars",
  "default_branch",
  "pushed_at",
  "og_image",
  "docker_image",
];

const PACKAGE_LANGUAGES = ["typescript", "python", "clojure"];
const PACKAGE_LANGUAGE_LABELS = {
  typescript: "TypeScript",
  python: "Python",
  clojure: "Clojure",
};
const PACKAGE_LANGUAGE_SET = new Set(PACKAGE_LANGUAGES);

// Registries whose images are accepted for submission. Anything else is rejected
// to prevent SSRF via arbitrary registry hostnames.
const ALLOWED_REGISTRIES = new Set([
  "registry-1.docker.io",
  "index.docker.io",
  "docker.io",
  "ghcr.io",
  "quay.io",
  "registry.gitlab.com",
  "gcr.io",
  "public.ecr.aws",
  "mcr.microsoft.com",
]);

function isAllowedRegistry(registry) {
  if (ALLOWED_REGISTRIES.has(registry)) return true;
  if (registry.endsWith(".pkg.dev")) return true; // Google Artifact Registry
  if (registry.endsWith(".ecr.aws")) return true; // AWS ECR regional
  return false;
}

// Extract hostname from a URL string without relying on the URL constructor.
function getUrlHost(url) {
  const m = String(url).match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

// Validate that a token realm URL is from a trusted host.
// Prevents SSRF via attacker-controlled WWW-Authenticate: Bearer realm= headers.
function isAllowedRealmUrl(realmUrl, registry) {
  if (!String(realmUrl).startsWith("https://")) return false;
  const host = getUrlHost(realmUrl);
  if (!host) return false;
  if (host === registry) return true;
  for (const allowed of ALLOWED_REGISTRIES) {
    if (host === allowed) return true;
    // e.g. auth.docker.io is trusted for registry-1.docker.io
    const dot = allowed.indexOf(".");
    if (dot !== -1 && host.endsWith(allowed.slice(dot))) return true;
  }
  if (host.endsWith(".pkg.dev")) return true;
  if (host.endsWith(".ecr.aws")) return true;
  return false;
}

function parseGithubName(url) {
  if (!url) return null;
  const m = String(url).match(
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)/i
  );
  if (!m) return null;
  let repo = m[2];
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  return m[1] + "/" + repo;
}

function githubHeaders() {
  const headers = { "User-Agent": "bigconfig-marketplace" };
  const token = $os.getenv("GITHUB_TOKEN");
  if (token) headers["Authorization"] = "Bearer " + token;
  return headers;
}

function fetchGithubMeta(name) {
  try {
    const res = $http.send({
      url: "https://api.github.com/repos/" + name,
      method: "GET",
      headers: githubHeaders(),
      timeout: 10,
    });
    if (res.statusCode !== 200) return null;
    const j = res.json;
    return {
      description: (j.description || "").slice(0, 500),
      stars: j.stargazers_count || 0,
      default_branch: j.default_branch || "",
      pushed_at: j.pushed_at || "",
      og_image: "https://opengraph.githubassets.com/1/" + name,
    };
  } catch (err) {
    console.log("[github] fetch failed for " + name + ": " + err);
    return null;
  }
}

function dispatchRebuild(reason) {
  const repo = $os.getenv("DISPATCH_REPO");
  const pat = $os.getenv("DISPATCH_PAT");
  if (!repo || !pat) {
    console.log(
      "[dispatch] skipped (DISPATCH_REPO/DISPATCH_PAT unset): " + reason
    );
    return;
  }
  try {
    $http.send({
      url: "https://api.github.com/repos/" + repo + "/dispatches",
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + pat,
        "User-Agent": "bigconfig-marketplace",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "rebuild-site",
        client_payload: { reason: reason },
      }),
      timeout: 10,
    });
    console.log("[dispatch] sent: " + reason);
  } catch (err) {
    console.log("[dispatch] failed: " + err);
  }
}

function isSuperuser(auth) {
  try {
    return auth && auth.collection().name === "_superusers";
  } catch (err) {
    return false;
  }
}

function parseJsonFieldValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (err) {
      throw new BadRequestError("language_branches must be a JSON object");
    }
  }
  if (value && typeof value === "object" && typeof value.string === "function") {
    const raw = value.string();
    if (!raw || raw === "null") return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new BadRequestError("language_branches must be a JSON object");
    }
  }
  return value;
}

function isSafeBranchName(branch) {
  if (!branch || branch.length > 200) return false;
  if (/\s/.test(branch)) return false;
  if (/[~^:?*[\\\x00-\x1f\x7f]/.test(branch)) return false;
  if (branch.indexOf("..") !== -1) return false;
  if (branch.indexOf("//") !== -1) return false;
  if (branch[0] === "/" || branch[branch.length - 1] === "/") return false;
  if (branch[branch.length - 1] === ".") return false;
  if (branch.endsWith(".lock")) return false;
  return true;
}

function normalizeLanguageBranches(value) {
  const parsed = parseJsonFieldValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BadRequestError(
      "language_branches must include at least one language branch mapping"
    );
  }

  const languageBranches = {};
  for (const language of Object.keys(parsed)) {
    if (!PACKAGE_LANGUAGE_SET.has(language)) {
      throw new BadRequestError(
        "unsupported package language: " + language +
          ". Supported: " + PACKAGE_LANGUAGES.join(", ")
      );
    }
    const rawBranch = parsed[language];
    if (typeof rawBranch !== "string") {
      throw new BadRequestError(
        "branch for " + PACKAGE_LANGUAGE_LABELS[language] + " must be a string"
      );
    }
    const branch = rawBranch.trim();
    if (!branch) {
      throw new BadRequestError(
        "branch for " + PACKAGE_LANGUAGE_LABELS[language] + " is required"
      );
    }
    if (!isSafeBranchName(branch)) {
      throw new BadRequestError(
        "branch for " + PACKAGE_LANGUAGE_LABELS[language] +
          " contains unsupported characters"
      );
    }
    languageBranches[language] = branch;
  }

  const languages = PACKAGE_LANGUAGES.filter((language) => languageBranches[language]);
  if (languages.length === 0) {
    throw new BadRequestError(
      "language_branches must include at least one language branch mapping"
    );
  }

  return { languageBranches: languageBranches, languages: languages };
}

function validateGithubBranches(name, languageBranches) {
  for (const language of Object.keys(languageBranches)) {
    const branch = languageBranches[language];
    let res;
    try {
      res = $http.send({
        url:
          "https://api.github.com/repos/" +
          name +
          "/branches/" +
          encodeURIComponent(branch),
        method: "GET",
        headers: githubHeaders(),
        timeout: 10,
      });
    } catch (err) {
      throw new BadRequestError(
        "could not verify " + PACKAGE_LANGUAGE_LABELS[language] +
          " branch `" + branch + "`: " + err
      );
    }
    if (res.statusCode === 404) {
      throw new BadRequestError(
        PACKAGE_LANGUAGE_LABELS[language] + " branch not found on GitHub: " + branch
      );
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new BadRequestError(
        "could not verify " + PACKAGE_LANGUAGE_LABELS[language] +
          " branch `" + branch + "` on GitHub (HTTP " + res.statusCode + ")"
      );
    }
  }
}

// Parse `[registry/]repo[:tag]` into { registry, repo, tag }.
// Defaults: Docker Hub registry, `latest` tag, `library/` prefix for single-segment Hub repos.
function parseDockerImage(image) {
  if (!image) return null;
  let s = String(image).trim();
  if (!s) return null;

  let registry = "registry-1.docker.io";
  let rest = s;
  const slash = s.indexOf("/");
  if (slash !== -1) {
    const head = s.slice(0, slash);
    if (head.indexOf(".") !== -1 || head.indexOf(":") !== -1 || head === "localhost") {
      registry = head;
      rest = s.slice(slash + 1);
    }
  }

  let tag = "latest";
  const colon = rest.lastIndexOf(":");
  const slashAfter = rest.lastIndexOf("/");
  if (colon !== -1 && colon > slashAfter) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
  }

  let repo = rest;
  if (registry === "registry-1.docker.io" && repo.indexOf("/") === -1) {
    repo = "library/" + repo;
  }

  if (!repo || !tag) return null;
  return { registry: registry, repo: repo, tag: tag };
}

// Parse a `WWW-Authenticate: Bearer realm="...",service="...",scope="..."` header.
function parseBearerChallenge(header) {
  if (!header) return null;
  const s = String(header);
  if (s.slice(0, 7).toLowerCase() !== "bearer ") return null;
  const params = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    params[m[1].toLowerCase()] = m[2];
  }
  if (!params.realm) return null;
  return params;
}

function getHeader(res, name) {
  if (!res || !res.headers) return "";
  // Go canonicalizes header names (e.g. "Www-Authenticate"), but be defensive.
  const want = name.toLowerCase();
  for (const k of Object.keys(res.headers)) {
    if (k.toLowerCase() === want) {
      const v = res.headers[k];
      return Array.isArray(v) ? v[0] || "" : String(v || "");
    }
  }
  return "";
}

function fetchAnonymousToken(challenge, registry) {
  if (!isAllowedRealmUrl(challenge.realm, registry)) {
    console.log("[docker] rejected token realm not in allowlist: " + challenge.realm);
    return "";
  }
  let url = challenge.realm;
  const qs = [];
  if (challenge.service) qs.push("service=" + encodeURIComponent(challenge.service));
  if (challenge.scope) qs.push("scope=" + encodeURIComponent(challenge.scope));
  if (qs.length) url += (url.indexOf("?") === -1 ? "?" : "&") + qs.join("&");
  try {
    const res = $http.send({
      url: url,
      method: "GET",
      headers: { "User-Agent": "bigconfig-marketplace" },
      timeout: 10,
    });
    if (res.statusCode !== 200 || !res.json) return "";
    return res.json.token || res.json.access_token || "";
  } catch (err) {
    return "";
  }
}

// Validate that a public Docker image is reachable (manifest exists).
// Only images from known public registries are accepted; rejects private/unknown
// registries to prevent SSRF. Handles OCI Distribution token-auth challenge.
// Throws BadRequestError if the image is unreachable or genuinely private.
function validateDockerImage(image) {
  const parsed = parseDockerImage(image);
  if (!parsed) {
    throw new BadRequestError(
      "docker_image must look like [registry/]repo[:tag], e.g. ghcr.io/owner/app:v1"
    );
  }

  if (!isAllowedRegistry(parsed.registry)) {
    throw new BadRequestError(
      "docker_image uses an unsupported registry (" + parsed.registry + "). " +
      "Supported: Docker Hub, ghcr.io, quay.io, gcr.io, registry.gitlab.com, " +
      "public.ecr.aws, mcr.microsoft.com, *.pkg.dev, *.ecr.aws."
    );
  }

  const accept =
    "application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json";
  const manifestUrl =
    "https://" + parsed.registry + "/v2/" + parsed.repo + "/manifests/" + parsed.tag;

  function callManifest(token) {
    const headers = {
      "User-Agent": "bigconfig-marketplace",
      Accept: accept,
    };
    if (token) headers["Authorization"] = "Bearer " + token;
    return $http.send({
      url: manifestUrl,
      method: "GET",
      headers: headers,
      timeout: 15,
    });
  }

  let res;
  try {
    res = callManifest("");
  } catch (err) {
    throw new BadRequestError("could not reach registry for " + image + ": " + err);
  }

  if (res.statusCode === 401) {
    const challenge = parseBearerChallenge(getHeader(res, "Www-Authenticate"));
    if (challenge) {
      const token = fetchAnonymousToken(challenge, parsed.registry);
      if (token) {
        try {
          res = callManifest(token);
        } catch (err) {
          throw new BadRequestError(
            "could not reach registry for " + image + ": " + err
          );
        }
      }
    }
  }

  if (res.statusCode === 401 || res.statusCode === 403) {
    throw new BadRequestError(
      "docker_image is not publicly pullable (registry requires auth): " + image
    );
  }
  if (res.statusCode === 404) {
    throw new BadRequestError("docker_image not found: " + image);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new BadRequestError(
      "docker_image check failed (HTTP " + res.statusCode + "): " + image
    );
  }
}

module.exports = {
  PROTECTED_FIELDS,
  PACKAGE_LANGUAGES,
  PACKAGE_LANGUAGE_LABELS,
  normalizeLanguageBranches,
  validateGithubBranches,
  parseGithubName,
  fetchGithubMeta,
  dispatchRebuild,
  isSuperuser,
  parseDockerImage,
  validateDockerImage,
};
