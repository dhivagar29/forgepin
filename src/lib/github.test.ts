import { describe, expect, it, vi } from "vitest";
import { auditRepository, normalizeRepo } from "./github";
import { auditDemo } from "./demo";

const sha = "11bd71901bbe5b1630ceea73d27597364c9af683";
const source = "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/checkout@v4\n";
const repo = { full_name: "org/repo", default_branch: "release/stable", private: false };
const listing = [{ type: "file", name: "ci.yml", path: ".github/workflows/ci.yml", size: source.length }];
const file = (yaml = source) => ({ type: "file", encoding: "base64", size: yaml.length, content: Buffer.from(yaml).toString("base64") });
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function mockFetch(...responses: Response[]) { const mock = vi.fn<typeof fetch>(); for (const response of responses) mock.mockResolvedValueOnce(response); return mock; }

describe("GitHub live audit", () => {
  it("fetches default-branch workflows, classifies, and deduplicates ref lookups", async () => {
    const fetcher = mockFetch(json(repo), json(listing), json(file()), json({ sha }));
    const result = await auditRepository("org/repo", { fetcher });
    expect(result.summary.floating).toBe(2);
    expect(result.findings.every((f) => f.suggestion === `actions/checkout@${sha}`)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[1][0]).toBe("https://api.github.com/repos/org/repo/contents/.github/workflows?ref=release%2Fstable");
    expect(result.complete).toBe(true);
  });
  it("preserves findings when SHA lookup is rate-limited", async () => {
    const fetcher = mockFetch(json(repo), json(listing), json(file()), json({}, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000000" }));
    const result = await auditRepository("org/repo", { fetcher });
    expect(result.summary.floating).toBe(2);
    expect(result.findings[0].suggestion).toBeUndefined();
    expect(result.warnings[0].code).toBe("RATE_LIMIT");
    expect(result.complete).toBe(true);
    expect(result.rateLimit?.remaining).toBe(0);
  });
  it("marks incomplete file scans explicitly when rate-limited", async () => {
    const fetcher = mockFetch(json(repo), json([...listing, { ...listing[0], name: "deploy.yml", path: ".github/workflows/deploy.yml" }]), json(file()), json({}, 429));
    const result = await auditRepository("org/repo", { fetcher });
    expect(result.complete).toBe(false);
    expect(result.files).toHaveLength(1);
    expect(result.summary.floating).toBe(2);
    expect(result.warnings[0].code).toBe("RATE_LIMIT");
  });
  it("rejects private repositories before fetching any contents, even with a token", async () => {
    const fetcher = mockFetch(json({ ...repo, private: true }));
    await expect(auditRepository("org/repo", { fetcher, token: "test-token" })).rejects.toMatchObject({ code: "PRIVATE_REPO", status: 403 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([[404, "NOT_FOUND"], [401, "INVALID_TOKEN"], [403, "FORBIDDEN"], [429, "RATE_LIMIT"], [500, "GITHUB_ERROR"]])("handles GitHub HTTP %s", async (status, code) => {
    await expect(auditRepository("org/repo", { fetcher: mockFetch(json({}, status as number)) })).rejects.toMatchObject({ code });
  });
  it("returns an empty scan if the repository has no workflow directory", async () => {
    const result = await auditRepository("org/repo", { fetcher: mockFetch(json(repo), json({}, 404)) });
    expect(result.summary.total).toBe(0); expect(result.complete).toBe(true);
  });
  it("can disable optional SHA resolution", async () => {
    const fetcher = mockFetch(json(repo), json(listing), json(file()));
    const result = await auditRepository("org/repo", { fetcher, resolve: false });
    expect(result.summary.floating).toBe(2); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("sends a token only to the fixed GitHub API origin and excludes it from results", async () => {
    const fetcher = mockFetch(json(repo), json([]));
    const result = await auditRepository("org/repo", { fetcher, token: "test-secret" });
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/api.github.com\/repos\//);
      expect(init?.headers).toHaveProperty("Authorization", "Bearer test-secret");
      expect(init?.redirect).toBe("error");
    }
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });
  it("follows local composites with action.yaml fallback and breaks dependency cycles", async () => {
    const workflow = "jobs:\n  test:\n    steps:\n      - uses: ./.github/actions/setup";
    const composite = "runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v4\n    - uses: ./.github/actions/setup";
    const fetcher = mockFetch(json(repo), json(listing), json(file(workflow)), json({}, 404), json(file(composite)));
    const result = await auditRepository("org/repo", { fetcher, resolve: false });
    expect(result.files).toContain(".github/actions/setup/action.yaml");
    expect(result.summary).toMatchObject({ local: 2, floating: 1 });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("preserves action subpaths in suggestions and URL-encodes branch refs", async () => {
    const yaml = "jobs:\n  test:\n    steps:\n      - uses: org/action/nested@release/stable";
    const fetcher = mockFetch(json(repo), json(listing), json(file(yaml)), json({ sha }));
    const result = await auditRepository("org/repo", { fetcher });
    expect(fetcher.mock.calls[3][0]).toBe("https://api.github.com/repos/org/action/commits/release%2Fstable");
    expect(result.findings[0].suggestion).toBe(`org/action/nested@${sha}`);
  });
  it("does not label invalid YAML or oversized files as fully audited", async () => {
    const invalid = await auditRepository("org/repo", { fetcher: mockFetch(json(repo), json(listing), json(file("jobs: ["))) });
    expect(invalid.complete).toBe(false); expect(invalid.warnings[0].code).toBe("INVALID_YAML");
    const oversized = await auditRepository("org/repo", { fetcher: mockFetch(json(repo), json([{ ...listing[0], size: 300_000 }])) });
    expect(oversized.complete).toBe(false); expect(oversized.warnings[0].code).toBe("FILE_SIZE");
  });
  it("sanitizes network failures instead of leaking raw errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret-token"));
    await expect(auditRepository("org/repo", { fetcher })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    await expect(auditRepository("org/repo", { fetcher })).rejects.not.toThrow("secret-token");
  });
});

describe("repository validation and demo", () => {
  it.each(["https://github.com/org/repo", "org", "org/repo/extra", "org/..", "a/b?token=x", "a/b#ref", "../repo", "a/b@main"])("rejects invalid input %s before any network call", (input) => {
    expect(() => normalizeRepo(input)).toThrow();
  });
  it("trims valid owner/repo values", () => { expect(normalizeRepo("  Actions/checkout  ")).toBe("Actions/checkout"); });
  it("runs demo fixtures through the parser without making network requests", () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
    try {
      const result = auditDemo();
      expect(result.mode).toBe("demo"); expect(result.files).toHaveLength(3);
      expect(result.summary).toEqual({ total: 8, needsAttention: 5, pinned: 1, partial: 1, floating: 4, unparseable: 0, local: 1, docker: 1 });
      expect(result.findings.filter((f) => f.suggestion)).toHaveLength(5);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});
