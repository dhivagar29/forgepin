import { demoShas, demoWorkflows } from "../fixtures/workflows";
import { parseWorkflow, summarize } from "./parser";
import type { AuditResult } from "./types";

export function auditDemo(): AuditResult {
  const start = Date.now();
  const parsed = Object.entries(demoWorkflows).map(([file, source]) => parseWorkflow(file, source));
  const findings = parsed.flatMap((p) => p.findings).map((finding) => ({ ...finding, ...(demoShas[finding.uses] ? { suggestion: `${finding.action}@${demoShas[finding.uses]}` } : {}) }));
  return {
    repo: "actions/checkout", branch: "sample fixture", mode: "demo",
    files: Object.keys(demoWorkflows), findings, warnings: parsed.flatMap((p) => p.warnings), complete: true,
    summary: summarize(findings), auditedAt: new Date().toISOString(), durationMs: Date.now() - start,
  };
}
