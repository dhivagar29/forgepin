export type Status = "pinned" | "partial" | "floating" | "unparseable" | "local" | "docker";
export type Severity = "high" | "medium" | "ok" | "review";

export interface Finding {
  id: string;
  file: string;
  line: number;
  job: string;
  step: string;
  uses: string;
  action: string;
  ref: string | null;
  status: Status;
  severity: Severity;
  official: boolean;
  suggestion?: string;
}

export interface AuditWarning { code: string; message: string }
export interface AuditResult {
  repo: string;
  branch: string;
  mode: "live" | "demo";
  files: string[];
  findings: Finding[];
  warnings: AuditWarning[];
  complete: boolean;
  summary: Record<Status, number> & { total: number; needsAttention: number };
  auditedAt: string;
  durationMs: number;
  rateLimit?: { remaining: number; resetAt: string };
}

export interface ApiError { code: string; message: string; resetAt?: string }
