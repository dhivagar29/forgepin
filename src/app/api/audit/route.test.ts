import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function request(body: unknown) { return new Request("http://localhost/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("POST /api/audit", () => {
  it("returns an offline demo with no-store headers and no GitHub fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    const response = await POST(request({ mode: "demo" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).summary.total).toBe(8);
    expect(spy).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { repo: 42 }, { repo: "org/repo", token: 42 }, { repo: "org/repo", resolve: "yes" }])("rejects malformed request %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
  });
  it("rejects malformed JSON and non-JSON bodies", async () => {
    expect((await POST(new Request("http://localhost/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/audit", { method: "POST", body: "hi" }))).status).toBe(415);
  });
  it("limits incoming bodies before parsing", async () => {
    expect((await POST(request({ repo: "a".repeat(13_000) }))).status).toBe(413);
  });
  it("rejects tokens with header injection characters", async () => {
    expect((await POST(request({ repo: "org/repo", token: "token\r\nInvalid: yes" }))).status).toBe(400);
  });
  it("uses the server token fallback without returning the token", async () => {
    vi.stubEnv("GITHUB_TOKEN", "server-secret");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ full_name: "org/repo", default_branch: "main", private: false })).mockResolvedValueOnce(Response.json([]));
    const response = await POST(request({ repo: "org/repo" }));
    expect(response.status).toBe(200);
    expect(spy.mock.calls[0][1]?.headers).toHaveProperty("Authorization", "Bearer server-secret");
    expect(await response.text()).not.toContain("server-secret");
  });
  it("gives user-supplied tokens precedence over server configuration", async () => {
    vi.stubEnv("GITHUB_TOKEN", "server-secret");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ full_name: "org/repo", default_branch: "main", private: false })).mockResolvedValueOnce(Response.json([]));
    expect((await POST(request({ repo: "org/repo", token: "page-secret" }))).status).toBe(200);
    expect(spy.mock.calls[0][1]?.headers).toHaveProperty("Authorization", "Bearer page-secret");
  });
});
