import { JSON_SCHEMA, load } from "js-yaml";
import type { AuditWarning, Finding, Status } from "./types";

const fullSha = /^[a-f\d]{40}$/i;
const shortSha = /^[a-f\d]{7,39}$/i;
const remoteUse = /^([a-z\d](?:[a-z\d-]*[a-z\d])?\/[a-z\d_.-]+(?:\/[a-z\d_.-]+)*)@([^\s@]+)$/i;

export function classifyUse(uses: string): Pick<Finding, "action" | "ref" | "status" | "severity" | "official"> {
  const raw = uses.trim();
  const base = { action: raw, ref: null, official: false };
  if (/^\.\/[^\s]+$/.test(raw)) return { ...base, status: "local", severity: "ok" };
  if (raw.startsWith("docker://")) return { ...base, status: "docker", severity: "review" };
  const match = raw.match(remoteUse);
  if (!match || raw.includes("${{") || match[1].split("/").some((s) => s === "." || s === "..")) {
    return { ...base, status: "unparseable", severity: "review" };
  }
  const [, action, ref] = match;
  const official = action.split("/")[0].toLowerCase() === "actions";
  const status: Status = fullSha.test(ref) ? "pinned" : shortSha.test(ref) ? "partial" : "floating";
  return { action, ref, official, status, severity: status === "pinned" ? "ok" : official ? "high" : "medium" };
}

export function parseWorkflow(file: string, source: string): { findings: Finding[]; warnings: AuditWarning[] } {
  const findings: Finding[] = [];
  const warnings: AuditWarning[] = [];
  const positions = new WeakMap<object, number>();
  const stack: { start: number; children: { value: unknown; start: number }[] }[] = [];
  let doc: unknown;
  try {
    // JSON schema prevents executable/custom tags and implicit timestamp conversion.
    // Aliases stay shared objects; we only traverse known jobs/steps paths, never recursively expand them.
    doc = load(source, { schema: JSON_SCHEMA, maxDepth: 80, listener(event, state) {
      if (event === "open") { stack.push({ start: state.position, children: [] }); return; }
      const frame = stack.pop();
      if (!frame) return;
      stack[stack.length - 1]?.children.push({ value: state.result, start: frame.start });
      if (isMapping(state.result) && Object.hasOwn(state.result, "<<") && !warnings.some((w) => w.code === "YAML_MERGE")) {
        warnings.push({ code: "YAML_MERGE", message: `${file}: YAML merge keys are not expanded; inherited usages may be missing.` });
      }
      if (isMapping(state.result) && Object.hasOwn(state.result, "uses") && !positions.has(state.result)) {
        const usesKey = frame.children.find((child) => child.value === "uses");
        const offset = usesKey?.start ?? frame.start;
        // A scalar can start before its leading newline/indentation.
        const actual = offset + (source.slice(offset).match(/^\s*/)?.[0].length ?? 0);
        positions.set(state.result, source.slice(0, actual).split("\n").length);
      }
    } });
  } catch {
    return { findings, warnings: [{ code: "INVALID_YAML", message: `${file}: invalid YAML; this file was not audited.` }] };
  }
  function readUse(node: unknown, job: string, step: string) {
    if (!isMapping(node) || !Object.hasOwn(node, "uses")) return;
    const uses = typeof node.uses === "string" ? node.uses : "[non-literal uses]";
    const line = positions.get(node) ?? 1;
    findings.push({ id: `${file}:${line}:${findings.length}`, file, line, job, step, uses, ...classifyUse(uses) });
  }
  function steps(node: unknown, job: string) {
    if (node === undefined) return;
    if (!Array.isArray(node)) { warnings.push({ code: "UNSUPPORTED_YAML", message: `${file}: steps must be a sequence; these steps were not inspected.` }); return; }
    node.forEach((step, index) => {
      if (!isMapping(step)) {
        warnings.push({ code: "UNSUPPORTED_YAML", message: `${file}: a non-literal step could not be inspected.` });
        return;
      }
      const name = step.name ?? step.id;
      readUse(step, job, typeof name === "string" ? name : `Step ${index + 1}`);
    });
  }
  if (!isMapping(doc)) {
    return { findings, warnings: [{ code: "INVALID_WORKFLOW", message: `${file}: expected a YAML mapping; this file was not audited.` }] };
  }
  const jobs = doc.jobs;
  if (isMapping(jobs)) {
    for (const [job, value] of Object.entries(jobs)) {
      if (!isMapping(value)) {
        warnings.push({ code: "UNSUPPORTED_YAML", message: `${file}: job ${job} is not a literal mapping.` });
        continue;
      }
      readUse(value, job, "Reusable workflow");
      steps(value.steps, job);
    }
  } else if (jobs !== undefined) {
    warnings.push({ code: "UNSUPPORTED_YAML", message: `${file}: the jobs mapping could not be inspected.` });
  }
  const runs = doc.runs;
  if (isMapping(runs) && runs.using === "composite") steps(runs.steps, "composite");
  return { findings, warnings };
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function summarize(findings: Finding[]) {
  const summary = { total: findings.length, needsAttention: 0, pinned: 0, partial: 0, floating: 0, unparseable: 0, local: 0, docker: 0 };
  for (const finding of findings) {
    summary[finding.status]++;
    if (["floating", "partial", "unparseable"].includes(finding.status)) summary.needsAttention++;
  }
  return summary;
}
