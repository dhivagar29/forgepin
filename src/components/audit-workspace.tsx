"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { auditDemo } from "@/lib/demo";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronRight, Circle, CircleAlert, Code2, Copy, ExternalLink, FileCode2, Fingerprint, GitBranch, KeyRound, Layers3, LoaderCircle, LockKeyhole, Radar, ScanLine, ShieldCheck, Terminal, X } from "lucide-react";
import type { ApiError, AuditResult, Finding, Status } from "@/lib/types";

type Filter = "all" | "attention" | "pinned" | "other";
const statusLabels: Record<Status, string> = { pinned: "Pinned", partial: "Short SHA", floating: "Floating ref", unparseable: "Unparseable", local: "Local action", docker: "Container" };

function Github({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 19 4.77 5.07 5.07 0 0 0 18.91 1S17.73.65 15 2.48a13.38 13.38 0 0 0-7 0C5.27.65 4.09 1 4.09 1A5.07 5.07 0 0 0 4 4.77 5.44 5.44 0 0 0 2.5 8.55c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 8 18.13V22" /></svg>;
}

function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? "brand-small" : ""}`}><span className="brand-icon"><Fingerprint size={small ? 20 : 26} strokeWidth={2.2} /></span><span>forge<span className="brand-light">pin</span><span className="brand-dot">.</span></span></span>;
}

export default function AuditWorkspace() {
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [resolve, setResolve] = useState(true);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<"live" | "demo" | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const resultsRef = useRef<HTMLElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const busy = loading !== null;

  async function runAudit(mode: "live" | "demo") {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(mode); setError(null); setResult(null); setFilter("all"); setQuery("");
    try {
      if (mode === "demo") {
        setResult(auditDemo());
        window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
        return;
      }
      const response = await fetch("/api/audit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, token, resolve }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) { setError(data.error ?? { code: "AUDIT_FAILED", message: "The audit could not be completed. Please try again." }); return; }
      setResult(data as AuditResult);
      window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch {
      if (!controller.signal.aborted) setError({ code: "CONNECTION_ERROR", message: "The audit request could not finish. Check your connection and try again." });
    } finally {
      if (activeRequest.current === controller) { setLoading(null); activeRequest.current = null; }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void runAudit("live"); }
  function cancel() { activeRequest.current?.abort(); activeRequest.current = null; setLoading(null); }
  async function copy(value: string, id: string) {
    try { await navigator.clipboard.writeText(value); setCopied(id); setCopyError(false); window.setTimeout(() => setCopied(null), 2200); }
    catch { setCopyError(true); }
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `forgepin-${result.repo.replace("/", "-")}-${result.mode}.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  const visible = result?.findings.filter((finding) => {
    const matchesFilter = filter === "all" || (filter === "attention" && ["floating", "partial", "unparseable"].includes(finding.status)) || (filter === "pinned" && finding.status === "pinned") || (filter === "other" && ["local", "docker"].includes(finding.status));
    return matchesFilter && `${finding.action} ${finding.ref ?? ""} ${finding.file} ${finding.job} ${finding.step}`.toLowerCase().includes(query.toLowerCase());
  }) ?? [];
  const pinnedPercent = result && result.summary.total - result.summary.local - result.summary.docker > 0 ? Math.round(result.summary.pinned / (result.summary.total - result.summary.local - result.summary.docker) * 100) : 0;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to audit</a>
      <aside className="sidebar" aria-label="Primary navigation">
        <Link className="brand-link" href="/" aria-label="ForgePin home"><Brand /></Link>
        <div className="workspace-label">WORKSPACE <span>01</span></div>
        <nav>
          <a href="#main" className="nav-item active"><ScanLine size={18} /> Repository audit <span className="nav-dot" /></a>
          <button className="nav-item" onClick={() => setGuideOpen(true)}><Layers3 size={18} /> Pinning guide <ArrowUpRight className="nav-end" size={14} /></button>
        </nav>
        <div className="sidebar-note"><div className="note-orbit"><ShieldCheck size={22} /></div><h3>A smaller attack surface.</h3><p>One immutable reference at a time.</p><span className="tiny-label">BUILT FOR YOUR PIPELINE</span></div>
        <div className="sidebar-bottom"><span className="online-dot" /> Read-only by design <LockKeyhole size={12} /></div>
      </aside>

      <div className="main-shell">
        <header className="topbar"><div className="breadcrumb"><span className="mobile-brand"><Brand small /></span><span className="desktop-crumb">Workspace <ChevronRight size={13} /></span><span className="page-crumb">Repository audit</span></div><div className="topbar-right"><button className="mobile-guide" onClick={() => setGuideOpen(true)} aria-label="Open pinning guide"><Layers3 size={18} /></button><span className="version">v1.0</span><a href="https://github.com/dhivagar29/forgepin" target="_blank" rel="noreferrer" aria-label="ForgePin on GitHub"><Github size={19} /></a></div></header>

        <main id="main">
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy"><div className="eyebrow"><span className="accent-dash" /> GITHUB ACTIONS SECURITY</div><h1 id="hero-title">Trust your code.<br /><span>Pin your dependencies.</span></h1><p>Your workflow is only as secure as the actions it runs.<br className="desktop-break" /> Find floating refs. Get exact SHAs. Close the gap.</p><div className="hero-badges"><span><Check size={13} /> Public repositories</span><span><Check size={13} /> No installation</span><span><Check size={13} /> Open source</span></div></div>
            <div className="code-visual" aria-label="Example: replace a floating version tag with a full commit SHA"><div className="code-top"><span><FileCode2 size={13} /> your-workflow.yml</span><span className="code-dots">•••</span></div><div className="code-body"><div className="code-line"><span className="line-number">01</span><span className="syntax-muted">steps:</span></div><div className="code-line"><span className="line-number">02</span><span> - <span className="syntax-cyan">uses:</span> actions/checkout<span className="ref-highlight">@v4</span></span></div><div className="code-transition"><span className="transition-line" /><span className="transition-icon"><Fingerprint size={17} /></span><span>Make it immutable</span><ArrowDownToLine size={13} /></div><div className="code-line safe-line"><span className="line-number">02</span><span> - <span className="syntax-cyan">uses:</span> actions/checkout<span className="syntax-cyan">@11bd719…</span></span><Check size={13} /></div></div><div className="code-bottom"><ShieldCheck size={12} /> Full 40-character SHA. No moving targets.</div></div>
          </section>

          <section className="audit-panel" aria-labelledby="audit-heading">
            <div className="panel-heading"><div><span className="panel-icon"><Radar size={19} /></span><h2 id="audit-heading">Start an audit</h2></div><span className="read-only"><LockKeyhole size={12} /> Read-only access</span></div>
            <form onSubmit={submit}>
              <label className="field-label" htmlFor="repository">GitHub repository <span>PUBLIC</span></label>
              <div className="input-row"><div className="repository-field"><Github size={19} /><span className="input-prefix">github.com /</span><input id="repository" name="repository" value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="owner/repo" required maxLength={140} autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy} aria-describedby="repo-help" /></div><button type="submit" className="primary-button" disabled={busy}>{loading === "live" ? <LoaderCircle className="spin" size={17} /> : <ScanLine size={17} />}{loading === "live" ? "Auditing…" : "Audit repository"}{!busy && <ArrowRight size={16} />}</button></div>
              <p id="repo-help" className="field-help">Scans YAML workflows on the default branch. Your repository stays untouched.</p>
              <div className="form-options"><button className="token-toggle" type="button" onClick={() => setTokenOpen(!tokenOpen)} aria-expanded={tokenOpen} aria-controls="token-settings"><KeyRound size={14} /> {token ? "GitHub token added" : "Add GitHub token"}<span>optional</span><ChevronDown size={14} className={tokenOpen ? "rotate" : ""} /></button><label className="check-label"><input type="checkbox" checked={resolve} onChange={(event) => setResolve(event.target.checked)} disabled={busy} /> Resolve SHA suggestions</label></div>
              {tokenOpen && <div className="token-settings" id="token-settings"><label className="field-label" htmlFor="github-token">Personal access token</label><div className="token-row"><input type="password" id="github-token" value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_…" autoComplete="off" spellCheck={false} maxLength={1024} disabled={busy} aria-describedby="token-help" /><button type="button" className="subtle-button" onClick={() => setToken("")} disabled={!token || busy}>Clear</button></div><p className="field-help" id="token-help">Held only in this page’s memory and sent to the server for GitHub requests. Never saved or logged. Public repository read access is enough; private repositories are not supported.</p></div>}
            </form>
            <div className="demo-strip"><span><Terminal size={15} /><span>Just exploring? Take a look under the hood.</span></span><button type="button" onClick={() => void runAudit("demo")} disabled={busy}>{loading === "demo" ? <LoaderCircle size={14} className="spin" /> : null}Try demo <span className="demo-description">(actions/checkout sample fixture)</span><ArrowRight size={14} /></button></div>
          </section>

          {error && <div role="alert" className="message error-message"><CircleAlert size={20} /><div><strong>{error.code === "RATE_LIMIT" ? "GitHub rate limit reached" : "We couldn’t complete this audit"}</strong><p>{error.message}</p>{error.resetAt && <p>Rate limit resets at {new Date(error.resetAt).toLocaleTimeString()}.</p>}</div><button aria-label="Dismiss error" onClick={() => setError(null)}><X size={17} /></button></div>}

          <section ref={resultsRef} className="results-section" aria-labelledby="results-heading" aria-busy={busy}>
            <div className="section-heading"><div><h2 id="results-heading">Audit results</h2><span className={`section-tag ${result ? "ready" : ""}`}>{busy ? "SCANNING" : result ? result.mode === "demo" ? "DEMO" : "LIVE" : "READY WHEN YOU ARE"}</span></div>{result && <button className="subtle-button export-button" onClick={download}><ArrowDownToLine size={14} /> Export JSON</button>}</div>

            {busy ? <div className="empty-state loading-state" role="status"><div className="scan-orbit"><ScanLine size={29} /></div><h3>{loading === "demo" ? "Inspecting the sample workflows" : "Following your workflow dependencies"}</h3><p>{loading === "demo" ? "Running the same parser on bundled fixtures. No GitHub requests." : "Fetching YAML, classifying references, and checking available SHA suggestions."}</p><div className="loading-track"><span /></div><button className="subtle-button" onClick={cancel}>Cancel audit</button></div> : !result ? <div className="empty-state"><div className="empty-grid"><div className="empty-icon"><ScanLine size={26} /></div></div><h3>A clear view of your supply chain.</h3><p>Run an audit to see which actions are pinned,<br />which can change, and exactly how to fix them.</p><div className="empty-steps"><span><span>01</span> Fetch workflows</span><ChevronRight size={12} /><span><span>02</span> Inspect references</span><ChevronRight size={12} /><span><span>03</span> Pin with confidence</span></div></div> : <>
              <div className="result-context"><div><Github size={16} /><strong>{result.repo}</strong><span className="branch"><GitBranch size={12} />{result.branch}</span></div><span>{result.files.length} files inspected <span className="separator">/</span> {result.complete ? "Scan complete" : "Partial scan"}</span></div>
              {result.mode === "demo" && <div className="demo-notice"><Terminal size={15} /><p><strong>Offline sample.</strong> These bundled workflows demonstrate actions/checkout and other dependencies. This is not an audit of the live repository. SHA suggestions are fixed fixture values.</p></div>}
              {!result.complete && <div className="message warning-message" role="status"><CircleAlert size={18} /><div><strong>Partial audit — some files could not be inspected.</strong><p>Counts apply only to collected findings. Review the warnings before drawing conclusions.</p></div></div>}
              {result.warnings.length > 0 && <details className="warnings" open={result.warnings.some((w) => w.code === "RATE_LIMIT")}><summary><CircleAlert size={15} /> {result.warnings.length} audit {result.warnings.length === 1 ? "notice" : "notices"}<ChevronDown size={14} /></summary><ul>{result.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}</ul>{result.rateLimit && <p>GitHub requests remaining: {result.rateLimit.remaining}. Resets at {new Date(result.rateLimit.resetAt).toLocaleTimeString()}.</p>}</details>}
              <div className="stats-grid"><div className="stat-card"><span>Total usages <Layers3 size={15} /></span><strong>{result.summary.total.toString().padStart(2, "0")}</strong><p>Across {result.files.length} workflow & action files</p></div><div className="stat-card stat-attention"><span>Need attention <CircleAlert size={15} /></span><strong>{result.summary.needsAttention.toString().padStart(2, "0")}<span className="stat-mini">{result.summary.floating} floating</span></strong><p>Floating, short, or unparseable refs</p></div><div className="stat-card stat-pinned"><span>Fully pinned <ShieldCheck size={15} /></span><strong>{result.summary.pinned.toString().padStart(2, "0")}<span className="stat-mini">{pinnedPercent}% of remote refs</span></strong><p>Immutable 40-character commit SHAs</p></div><div className="stat-card"><span>Local & containers <Code2 size={15} /></span><strong>{(result.summary.local + result.summary.docker).toString().padStart(2, "0")}</strong><p>{result.summary.local} local · {result.summary.docker} containers skipped</p></div></div>
              <div className="findings-panel"><div className="findings-toolbar"><div className="filter-tabs" aria-label="Filter findings">{([ ["all", "All usages", result.summary.total], ["attention", "Needs attention", result.summary.needsAttention], ["pinned", "Pinned", result.summary.pinned], ["other", "Other", result.summary.local + result.summary.docker] ] as const).map(([value, label, count]) => <button key={value} onClick={() => setFilter(value)} className={filter === value ? "selected" : ""} aria-pressed={filter === value}>{label}<span>{count}</span></button>)}</div><label className="search-field"><span className="sr-only">Filter by action, file, or job</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter actions or files…" /></label></div>
                {visible.length ? <div className="findings-list"><div className="table-heading"><span>ACTION / WORKFLOW</span><span>REFERENCE</span><span>STATUS</span><span>REMEDIATION</span></div>{visible.map((finding) => <FindingRow key={finding.id} finding={finding} result={result} copied={copied === finding.id} onCopy={() => void copy(`uses: ${finding.suggestion}`, finding.id)} />)}</div> : <div className="no-findings"><CheckCheck size={27} /><h3>{result.summary.total === 0 ? result.complete ? "No action usages found" : "No usages collected in this partial scan" : "No matching findings"}</h3><p>{result.summary.total === 0 ? result.complete ? "This scan found no uses references in the available workflow files." : "Some files could not be inspected. Review the audit notices and retry." : "Try another filter or clear your search."}</p>{query && <button className="subtle-button" onClick={() => setQuery("")}>Clear search</button>}</div>}
                <div className="findings-footer"><span>{visible.length} of {result.summary.total} usages shown</span><span><Circle size={8} /> {result.mode === "demo" ? "Fixture suggestions" : "Review resolved commits before applying"}</span></div>
              </div>
              <div className="scan-meta"><span><ShieldCheck size={13} /> No repository files were modified.</span><span>Audited {new Date(result.auditedAt).toLocaleString()}{result.rateLimit ? ` · ${result.rateLimit.remaining} API requests remaining` : ""}</span></div>
            </>}
          </section>

          <section className="explainer-grid" aria-label="How ForgePin works"><div><span className="explainer-number">01 / DISCOVER</span><h3><FileCode2 size={17} /> Every workflow, in focus</h3><p>Inspect default-branch workflows and referenced composites under .github/actions.</p></div><div><span className="explainer-number">02 / CLASSIFY</span><h3><GitBranch size={17} /> Spot the moving targets</h3><p>Separate immutable SHAs from floating tags, branches, and shortened references.</p></div><div><span className="explainer-number">03 / REMEDIATE</span><h3><ShieldCheck size={17} /> Leave with a concrete fix</h3><p>Copy resolved commit references into your workflows. Review, commit, and ship.</p></div></section>
          <footer><span><Brand small /> <span className="footer-caption">A little certainty in your supply chain.</span></span><a href="https://github.com/dhivagar29/forgepin" target="_blank" rel="noreferrer">Source on GitHub<ArrowUpRight size={13} /></a></footer>
        </main>
      </div>
      <div className="sr-only" role="status" aria-live="polite">{copied ? "Pinned uses line copied to clipboard." : result ? `Audit complete. ${result.summary.total} usages found. ${result.summary.needsAttention} need attention.${result.complete ? "" : " Scan is partial."}` : ""}</div>
      {copyError && <div className="copy-toast" role="alert">Clipboard unavailable. Select and copy the SHA line manually.<button onClick={() => setCopyError(false)} aria-label="Dismiss clipboard notice"><X size={14} /></button></div>}
      {guideOpen && <PinningGuide onClose={() => setGuideOpen(false)} />}
    </div>
  );
}

function FindingRow({ finding, result, copied, onCopy }: { finding: Finding; result: AuditResult; copied: boolean; onCopy: () => void }) {
  const fileUrl = `https://github.com/${result.repo}/blob/${encodeURIComponent(result.branch)}/${finding.file.split("/").map(encodeURIComponent).join("/")}#L${finding.line}`;
  return <article className="finding-row"><div className="finding-action"><div><span className={`action-avatar ${finding.official ? "official" : ""}`}>{finding.status === "local" ? <Code2 size={17} /> : finding.status === "docker" ? <Layers3 size={17} /> : finding.official ? <Github size={17} /> : finding.action.charAt(0).toUpperCase()}</span><div><strong>{finding.action}</strong><span className="finding-context">{finding.job} <ChevronRight size={10} /> {finding.step}</span></div></div>{result.mode === "live" ? <a className="file-link" href={fileUrl} target="_blank" rel="noreferrer"><FileCode2 size={11} />{finding.file}:{finding.line}<ExternalLink size={10} /></a> : <span className="file-link"><FileCode2 size={11} />{finding.file}:{finding.line}</span>}</div><div className="ref-cell"><span className="mobile-cell-label">Reference</span><code title={finding.ref ?? finding.uses}>{finding.ref ? `@${finding.ref.length > 16 ? `${finding.ref.slice(0, 10)}…` : finding.ref}` : "—"}</code>{finding.status === "pinned" && <span className="ref-description">40-character SHA</span>}</div><div className="status-cell"><span className={`status-badge status-${finding.status}`}><span />{statusLabels[finding.status]}</span><span className="severity">{finding.severity === "high" || finding.severity === "medium" ? `${finding.severity} severity` : finding.status === "docker" ? "Outside SHA audit" : finding.status === "local" ? "Repository-local reference" : finding.severity === "review" ? "Manual review" : "Immutable reference"}</span></div><div className="remediation-cell">{finding.suggestion ? <><button className={`copy-button ${copied ? "copied" : ""}`} onClick={onCopy}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied uses line" : "Copy pinned action"}</button><details className="sha-details"><summary>View full SHA</summary><code>uses: {finding.suggestion}</code></details></> : <span className="remediation-note">{finding.status === "pinned" ? <><Check size={14} /> Already pinned</> : finding.status === "local" ? "No external ref" : finding.status === "docker" ? "Review image digest" : "No SHA suggestion"}</span>}</div></article>;
}

function PinningGuide({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  return <dialog className="guide-dialog" ref={(node) => { ref.current = node; if (node && !node.open) node.showModal(); }} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="guide-title"><div className="guide-inner"><button className="dialog-close" onClick={onClose} aria-label="Close pinning guide" autoFocus><X size={20} /></button><span className="eyebrow">THE PINNING FIELD GUIDE</span><h2 id="guide-title">A tag can move.<br />A commit SHA stays put.</h2><p>Actions execute code in your CI environment. Pinning a remote action to its full 40-character commit SHA fixes the exact version your workflow runs.</p><div className="guide-example"><code>uses: actions/checkout@v4</code><ArrowDownToLine size={16} /><code>uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683</code></div><ul><li><strong>Floating refs:</strong> tags and branches can point to different commits later. ForgePin assigns high severity to the actions organization and medium to other publishers. This is a prioritization policy, not an assessment of publisher trust.</li><li><strong>Short SHAs:</strong> abbreviated refs are only partially pinned. Use the full commit SHA.</li><li><strong>Review before applying:</strong> a resolved SHA reflects the current ref, not a guarantee that its code is safe. Inspect the commit and test your workflow.</li><li><strong>Scope:</strong> local references are marked OK; referenced composites in .github/actions are inspected. Container images are listed separately and need digest review. Remote action internals and reusable workflow contents are not recursively audited.</li></ul><a href="https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions" target="_blank" rel="noreferrer">Read GitHub’s security guidance <ArrowUpRight size={14} /></a></div></dialog>;
}
