# ForgePin

Find unpinned GitHub Actions. Replace floating references with immutable commit SHAs.

Live: _Add your Vercel URL here_

## Features

- Real public-repository audits through `POST /api/audit`, using GitHub’s REST API.
- Default-branch `.github/workflows/*.yml` and `*.yaml` inspection, plus referenced local composite actions under `.github/actions/**` (with cycle detection).
- YAML-aware extraction of step and reusable-workflow `uses` references, including file, source line, job, and step context. Comments and shell scripts are not treated as action usages.
- Full SHA, short SHA, floating tag/branch, unparseable, local, and container classifications.
- Optional full SHA suggestions, deduplicated per action repository/ref, with one-click copy and manual copy fallback.
- Status filters, action/file search, source links, counts, and downloadable JSON reports.
- Offline **Try demo (actions/checkout sample fixture)** mode. Bundled YAML runs through the same parser entirely in the browser, without any network requests once the page is loaded. The API also supports the fixture for programmatic use. Demo SHA mappings are fixed sample data, not live tag resolutions or a scan of the actual actions/checkout repository.
- Responsive graphite/cyan interface, labeled inputs, keyboard-accessible guide dialog, reduced-motion support, loading/cancel states, and explicit error/partial-scan states.

## Local development

Requires **Node.js 22** and npm. `.nvmrc` and `package.json#engines` specify the runtime.

```bash
nvm use # if you use nvm
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). Enter `owner/repo` and select **Audit repository**, or use **Try demo** without credentials or GitHub connectivity.

```bash
npm run lint && npm run typecheck && npm test && npm run build
npm start
```

Production and development use Webpack. The app does not fetch external fonts during build and requires no database, authentication service, CMS, or paid API.

## Environment and privacy

No environment variables are required. For a higher GitHub rate limit, either enter a token in the UI or copy `.env.example` to `.env.local` and set:

```dotenv
GITHUB_TOKEN=your_optional_server_side_token
```

Use a token that can read public repository contents. Keep this variable server-side; never add a `NEXT_PUBLIC_` prefix. The UI token takes precedence over the `Authorization: Bearer ...` header and server environment fallback. Tokens entered in the UI exist only in React memory; refreshing the page clears them. They are transmitted to the same-origin server route, forwarded only to `https://api.github.com`, and never included in results, logs, browser storage, or exports. Responses and outbound requests use `no-store`. The app follows no redirects when making authenticated GitHub requests.

Private repositories are explicitly rejected even when a token has access. GitHub may return 404 for a private repository; ForgePin explains both missing and private possibilities. No repository files are modified. The app neither stores scan history nor runs workflow code.

## API

```bash
curl http://localhost:3000/api/audit \
  -H 'Content-Type: application/json' \
  -d '{"repo":"actions/checkout","resolve":true}'

curl http://localhost:3000/api/audit \
  -H 'Content-Type: application/json' \
  -d '{"mode":"demo"}'
```

Successful responses include `repo`, `branch`, `mode`, `files`, `findings`, `summary`, `warnings`, `complete`, timestamps, and available rate-limit metadata. Errors return `{ "error": { "code", "message", "resetAt"? } }` with an appropriate HTTP status.

The server fetches repository metadata, lists `.github/workflows` on the default branch, downloads YAML through the contents endpoint, then optionally resolves refs with `/repos/{owner}/{repo}/commits/{ref}`. Subpaths remain intact in suggested replacement lines. A suggestion is the commit a ref resolves to at scan time; review that commit and test your workflow before applying it.

## Classification and scope

| Status | Rule | Severity |
| --- | --- | --- |
| Pinned | Exactly 40 hexadecimal characters | OK |
| Short SHA | 7–39 hexadecimal characters | High for `actions/*`; medium otherwise |
| Floating ref | Any other literal tag or branch | High for `actions/*`; medium otherwise |
| Unparseable | Missing ref, malformed syntax, non-string or dynamic expression | Manual review |
| Local action | `./...` reference | OK as a repository-local reference |
| Container | `docker://...` | Separate review; image digest pinning is outside this audit |

“Official” means the `actions` organization only. Severity is a transparent prioritization policy, not a claim that any publisher is safe or malicious. Short hexadecimal tags are conservatively classified as partial SHAs. Pinned counts describe reference immutability, not code safety.

Limits: 50 files, 256 KB per file, 90 GitHub requests, 20 unique SHA lookups, 12 seconds per request, and a 45-second scan deadline (route maximum: 60 seconds). File failures, unsupported YAML structures, and exceeded scan limits produce an explicitly partial scan. SHA-resolution failures do not invalidate findings already collected. Rate-limit errors include reset metadata when GitHub supplies it.

Local composites are followed only under `.github/actions`; other local references are listed but their contents are outside scope. Remote action internals and reusable workflow contents are not recursively audited. YAML aliases are shared objects, without recursive expansion; alias source links point to the original anchored mapping. Custom YAML tags are rejected and merge keys are not expanded. GitHub directory listings are limited by its contents API. Pin suggestions do not verify the publisher, commit signature, or behavior of the resolved code.

The route is deliberately stateless. A public deployment with a shared server token should apply host-level request throttling to protect its shared GitHub quota.

## Structure

```text
src/app/                     App Router page, metadata, styles, icon
src/app/api/audit/            POST route and request-contract tests
src/components/              Interactive audit workspace and pinning guide
src/fixtures/workflows.ts    Bundled demo YAML and fixed SHA mappings
src/lib/parser.ts            YAML extraction, classification, summaries
src/lib/github.ts            GitHub client, traversal, limits, SHA resolution
src/lib/demo.ts              Network-free demo runner
src/lib/*.test.ts            Parser/classifier and GitHub integration tests
src/types/                   Minimal typed js-yaml API surface
```

Tests cover YAML context and source lines, quoted/flow syntax, comments and shell blocks, reusable workflows, composites and aliases, classification, request validation, token privacy, private/404/rate-limit states, partial scans, lookup deduplication, and network-free demo execution. GitHub integration tests use deterministic HTTP mocks.

Before publishing, replace `https://github.com/dhivagar29/forgepin` in the footer with your repository URL and fill in the `Live:` line above.

API references: [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [GitHub repository contents](https://docs.github.com/en/rest/repos/contents), [GitHub commits](https://docs.github.com/en/rest/commits/commits), [GitHub Actions security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions).
