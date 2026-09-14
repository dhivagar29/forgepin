import { auditDemo } from "@/lib/demo";
import { AuditError, auditRepository } from "@/lib/github";

export const runtime = "nodejs";
export const maxDuration = 60;

const headers = { "Cache-Control": "no-store", "Vary": "Authorization" };

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) throw new AuditError("INVALID_REQUEST", "Send a JSON request body.", 415);
    const reader = request.body?.getReader();
    if (!reader) throw new AuditError("INVALID_REQUEST", "A request body is required.", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12_000) { await reader.cancel(); throw new AuditError("INVALID_REQUEST", "Request body is too large.", 413); }
      chunks.push(value);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
    catch { throw new AuditError("INVALID_REQUEST", "Request body must be valid JSON.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AuditError("INVALID_REQUEST", "Expected a JSON object.", 400);
    const data = body as Record<string, unknown>;
    if (data.mode === "demo") return Response.json(auditDemo(), { headers });
    if (typeof data.repo !== "string" || (data.token !== undefined && typeof data.token !== "string") || (data.resolve !== undefined && typeof data.resolve !== "boolean")) throw new AuditError("INVALID_REQUEST", "Provide a repository and a valid optional token and resolution setting.", 400);
    const authorization = request.headers.get("authorization");
    const token = (typeof data.token === "string" ? data.token.trim() : "") || authorization?.replace(/^Bearer\s+/i, "") || process.env.GITHUB_TOKEN;
    if (token && (token.length > 1024 || !/^[\x21-\x7e]+$/.test(token))) throw new AuditError("INVALID_TOKEN", "The token contains invalid characters or is too long.", 400);
    const result = await auditRepository(data.repo, { token, resolve: data.resolve !== false });
    return Response.json(result, { headers });
  } catch (error) {
    const known = error instanceof AuditError;
    // Never log requests, tokens, GitHub payloads, or raw errors.
    return Response.json({ error: { code: known ? error.code : "INTERNAL_ERROR", message: known ? error.message : "The audit could not be completed. Please try again or use the demo.", ...(known && error.resetAt ? { resetAt: error.resetAt } : {}) } }, { status: known ? error.status : 500, headers });
  }
}
