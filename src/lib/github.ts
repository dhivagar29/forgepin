import { parseWorkflow, summarize } from "./parser";
import type { AuditResult, AuditWarning, Finding } from "./types";

export class AuditError extends Error {
  constructor(public code: string, message: string, public status = 500, public resetAt?: string) {
    super(message);
  }
}

export function normalizeRepo(input: string): string {
  const repo = input.trim();
  if (repo.length > 140 || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\/[a-z\d_.-]{1,100}$/i.test(repo) || [".", ".."].includes(repo.split("/")[1])) {
    throw new AuditError("INVALID_REPO", "Enter a public repository as owner/repo, for example actions/checkout.", 400);
  }
  return repo;
}

interface RepoInfo { full_name: string; default_branch: string; private: boolean }
interface Content { type: string; name: string; path: string; size: number; content?: string; encoding?: string }
interface Options { token?: string; resolve?: boolean; fetcher?: typeof fetch }
const MAX_FILES = 50;
const MAX_FILE_SIZE = 256_000;
const MAX_RESOLUTIONS = 20;

export async function auditRepository(input: string, options: Options = {}): Promise<AuditResult> {
  const repo = normalizeRepo(input);
  const start = Date.now();
  const fetcher = options.fetcher ?? fetch;
  const warnings: AuditWarning[] = [];
  const findings: Finding[] = [];
  const files: string[] = [];
  let complete = true;
  let requests = 0;
  let rateLimit: AuditResult["rateLimit"];
  const deadline = AbortSignal.timeout(45_000);

  async function github<T>(path: string): Promise<T> {
    if (deadline.aborted) throw new AuditError("TIMEOUT", "GitHub took too long to respond. Try again in a moment.", 504);
    if (++requests > 90) throw new AuditError("SCAN_LIMIT", "The request budget was reached. Some files or suggestions could not be loaded.", 422);
    let response: Response;
    try {
      response = await fetcher(`https://api.github.com${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "ForgePin",
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([deadline, AbortSignal.timeout(12_000)]),
      });
    } catch {
      throw new AuditError("NETWORK_ERROR", "GitHub could not be reached or the request timed out. Try again, or run the offline demo.", 502);
    }
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    const resetNumber = Number(reset);
    const resetAt = reset && Number.isFinite(resetNumber) && resetNumber > 0 && resetNumber < 1e11
      ? new Date(resetNumber * 1000).toISOString() : undefined;
    if (remaining !== null && resetAt) rateLimit = { remaining: Number(remaining), resetAt };
    if (response.status === 429 || (response.status === 403 && (remaining === "0" || response.headers.has("retry-after")))) {
      throw new AuditError("RATE_LIMIT", "GitHub’s API rate limit was reached. Add a token, wait for the limit to reset, or try the offline demo.", 429, resetAt);
    }
    if (response.status === 401) throw new AuditError("INVALID_TOKEN", "GitHub rejected this token. Clear it or provide a valid token with public repository read access.", 401);
    if (response.status === 404) throw new AuditError("NOT_FOUND", "Repository not found. Check the spelling and visibility. Private repositories are not supported, even with a token.", 404);
    if (response.status === 403) throw new AuditError("FORBIDDEN", "GitHub refused the request. Your token may lack access, or GitHub may be temporarily limiting requests.", 403);
    if (!response.ok) throw new AuditError("GITHUB_ERROR", "GitHub returned an unexpected response. Please try again shortly.", 502);
    try { return await response.json() as T; }
    catch { throw new AuditError("GITHUB_ERROR", "GitHub returned an unreadable response. Please try again.", 502); }
  }

  const info = await github<RepoInfo>(`/repos/${repo}`);
  if (info.private) throw new AuditError("PRIVATE_REPO", "ForgePin audits public repositories only. Private repositories are not supported, even with a token.", 403);
  const branch = info.default_branch;
  const contentsPath = (path: string) => `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`;
  let entries: Content[];
  try {
    entries = await github<Content[]>(contentsPath(".github/workflows"));
  } catch (error) {
    if (error instanceof AuditError && error.code === "NOT_FOUND") entries = [];
    else throw error;
  }
  if (!Array.isArray(entries)) throw new AuditError("INVALID_WORKFLOWS", "The .github/workflows path is not a directory.", 422);
  const workflows = entries.filter((entry) => entry.type === "file" && /\.ya?ml$/i.test(entry.name)).sort((a, b) => a.path.localeCompare(b.path));
  if (entries.length >= 1000) { complete = false; warnings.push({ code: "DIRECTORY_LIMIT", message: "GitHub’s directory listing limit was reached. Additional workflows may be missing." }); }
  if (workflows.length > MAX_FILES) { complete = false; warnings.push({ code: "FILE_LIMIT", message: `Only the first ${MAX_FILES} YAML files can be audited in one scan.` }); }

  const visited = new Set<string>();
  const localQueue: string[] = [];
  function warn(error: unknown, file: string) {
    complete = false;
    warnings.push({ code: error instanceof AuditError ? error.code : "FILE_ERROR", message: `${file}: ${error instanceof AuditError ? error.message : "could not be inspected."}` });
  }
  async function inspect(path: string, knownSize = 0): Promise<boolean> {
    if (visited.has(path)) return true;
    if (files.length >= MAX_FILES) throw new AuditError("FILE_LIMIT", `The ${MAX_FILES}-file audit limit was reached.`, 422);
    if (knownSize > MAX_FILE_SIZE) throw new AuditError("FILE_SIZE", "File exceeds the 256 KB audit limit.", 422);
    const content = await github<Content>(contentsPath(path));
    if (content.type !== "file" || content.encoding !== "base64" || typeof content.content !== "string") throw new AuditError("FILE_CONTENT", "File contents are unavailable or not a regular file.", 422);
    if (content.size > MAX_FILE_SIZE || content.content.length > MAX_FILE_SIZE * 1.5) throw new AuditError("FILE_SIZE", "File exceeds the 256 KB audit limit.", 422);
    visited.add(path);
    files.push(path);
    const parsed = parseWorkflow(path, Buffer.from(content.content, "base64").toString("utf8"));
    findings.push(...parsed.findings);
    warnings.push(...parsed.warnings);
    if (parsed.warnings.length) complete = false;
    for (const finding of parsed.findings) {
      if (finding.status === "local" && finding.uses.startsWith("./.github/actions/")) {
        const local = finding.uses.slice(2).replace(/\/$/, "");
        if (!local.split("/").some((part) => ["..", ".", ""].includes(part))) localQueue.push(local);
      }
    }
    return true;
  }
  for (const entry of workflows.slice(0, MAX_FILES)) {
    try { await inspect(entry.path, entry.size); }
    catch (error) {
      warn(error, entry.path);
      if (error instanceof AuditError && ["RATE_LIMIT", "INVALID_TOKEN", "SCAN_LIMIT", "TIMEOUT", "NETWORK_ERROR"].includes(error.code)) break;
    }
  }
  const localVisited = new Set<string>();
  for (let index = 0; index < localQueue.length && index < MAX_FILES; index++) {
    const path = localQueue[index];
    if (localVisited.has(path)) continue;
    localVisited.add(path);
    try {
      try { await inspect(`${path}/action.yml`); }
      catch (error) {
        if (error instanceof AuditError && error.code === "NOT_FOUND") await inspect(`${path}/action.yaml`);
        else throw error;
      }
    } catch (error) {
      warn(error, path);
      if (error instanceof AuditError && ["RATE_LIMIT", "SCAN_LIMIT", "TIMEOUT", "FILE_LIMIT", "NETWORK_ERROR"].includes(error.code)) break;
    }
  }
  if (localQueue.length > MAX_FILES) { complete = false; warnings.push({ code: "COMPOSITE_LIMIT", message: "The local composite traversal limit was reached; some local actions may not have been inspected." }); }

  if (options.resolve !== false && !warnings.some((w) => ["RATE_LIMIT", "TIMEOUT", "NETWORK_ERROR"].includes(w.code))) {
    const pending = findings.filter((f) => f.status === "floating" || f.status === "partial");
    const refs = new Map<string, string | null>();
    for (const finding of pending) {
      const actionRepo = finding.action.split("/").slice(0, 2).join("/");
      const key = `${actionRepo}@${finding.ref}`;
      if (!refs.has(key)) {
        if (refs.size >= MAX_RESOLUTIONS) {
          warnings.push({ code: "RESOLUTION_LIMIT", message: `SHA suggestions are limited to ${MAX_RESOLUTIONS} unique references. All collected usages are still classified.` });
          break;
        }
        refs.set(key, null);
        try {
          const commit = await github<{ sha: string }>(`/repos/${actionRepo}/commits/${encodeURIComponent(finding.ref!)}`);
          if (/^[a-f\d]{40}$/i.test(commit.sha)) refs.set(key, commit.sha);
          else warnings.push({ code: "RESOLUTION_FAILED", message: `No full commit SHA was returned for ${key}.` });
        } catch (error) {
          const code = error instanceof AuditError ? error.code : "RESOLUTION_FAILED";
          warnings.push({ code, message: code === "RATE_LIMIT" ? "GitHub rate-limited SHA suggestions. Collected findings are still available. Add a token or retry after the limit resets." : `Could not resolve ${key}. Review this ref on GitHub before replacing it.` });
          if (["RATE_LIMIT", "INVALID_TOKEN", "FORBIDDEN", "SCAN_LIMIT", "TIMEOUT", "NETWORK_ERROR"].includes(code)) break;
        }
      }
    }
    for (const finding of pending) {
      const sha = refs.get(`${finding.action.split("/").slice(0, 2).join("/")}@${finding.ref}`);
      if (sha) finding.suggestion = `${finding.action}@${sha}`;
    }
  }
  return { repo: info.full_name, branch, mode: "live", files, findings, warnings, complete, summary: summarize(findings), auditedAt: new Date().toISOString(), durationMs: Date.now() - start, ...(rateLimit ? { rateLimit } : {}) };
}
