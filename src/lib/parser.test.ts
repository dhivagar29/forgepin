import { describe, expect, it } from "vitest";
import { classifyUse, parseWorkflow, summarize } from "./parser";

const sha = "11bd71901bbe5b1630ceea73d27597364c9af683";
const workflow = (steps: string) => `name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;

describe("classifyUse", () => {
  it("accepts full lowercase and uppercase 40-character SHAs", () => {
    expect(classifyUse(`actions/checkout@${sha}`)).toMatchObject({ status: "pinned", severity: "ok", ref: sha });
    expect(classifyUse(`actions/checkout@${sha.toUpperCase()}`).status).toBe("pinned");
  });
  it("marks official floating actions high severity", () => {
    expect(classifyUse("actions/checkout@v4")).toMatchObject({ status: "floating", severity: "high", official: true });
  });
  it("marks third-party branches medium severity", () => {
    expect(classifyUse("acme/build@main")).toMatchObject({ status: "floating", severity: "medium", official: false });
  });
  it("does not mistake lookalike organizations for official actions", () => {
    expect(classifyUse("actions-extra/checkout@v4").official).toBe(false);
  });
  it("recognizes 7–39 character abbreviated SHAs but never calls them fully pinned", () => {
    for (const length of [7, 12, 39]) expect(classifyUse(`acme/test@${sha.slice(0, length)}`).status).toBe("partial");
    expect(classifyUse(`acme/test@${sha}a`).status).toBe("floating");
  });
  it("handles action subpaths and reusable workflow refs containing slashes", () => {
    expect(classifyUse("acme/ci/.github/workflows/test.yml@release/stable")).toMatchObject({ action: "acme/ci/.github/workflows/test.yml", ref: "release/stable", status: "floating" });
  });
  it("marks repository-local references OK", () => {
    expect(classifyUse("./.github/actions/setup")).toMatchObject({ status: "local", severity: "ok" });
  });
  it("keeps tagged and digest-pinned Docker references outside the action SHA audit", () => {
    expect(classifyUse("docker://alpine:3.20").status).toBe("docker");
    expect(classifyUse(`docker://alpine@sha256:${"a".repeat(64)}`).severity).toBe("review");
  });
  it.each(["actions/checkout", "actions/checkout@", "actions/checkout@v4@main", "https://evil.test/action@v1", "actions/checkout@${{ inputs.version }}", "a/b/../c@main", "", "./invalid path"])("reports malformed or dynamic usage %s", (uses) => {
    expect(classifyUse(uses).status).toBe("unparseable");
  });
});

describe("parseWorkflow", () => {
  it("extracts quoted uses values, names, jobs, and the source line", () => {
    const parsed = parseWorkflow("ci.yml", workflow('      - name: Checkout source\n        uses: "actions/checkout@v4" # update later\n'));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]).toMatchObject({ uses: "actions/checkout@v4", job: "test", step: "Checkout source", line: 8, file: "ci.yml" });
  });
  it("ignores comments, shell blocks, env variables, and unrelated uses keys", () => {
    const parsed = parseWorkflow("ci.yml", workflow('      # uses: actions/checkout@main\n      - run: |\n          echo "uses: actions/checkout@main"\n        env:\n          uses: actions/checkout@v4\n      - uses: acme/build@v1\n'));
    expect(parsed.findings.map((f) => f.action)).toEqual(["acme/build"]);
    expect(parsed.findings[0].line).toBe(12);
  });
  it("parses flow-style YAML and gives unnamed steps useful context", () => {
    const result = parseWorkflow("ci.yaml", "jobs: { test: { steps: [ { uses: 'actions/checkout@v4' } ] } }");
    expect(result.findings[0]).toMatchObject({ step: "Step 1", line: 1, status: "floating" });
  });
  it("finds job-level reusable workflow calls", () => {
    expect(parseWorkflow("ci.yml", "jobs:\n  call:\n    uses: org/repo/.github/workflows/ci.yml@main").findings[0]).toMatchObject({ job: "call", step: "Reusable workflow", status: "floating" });
  });
  it("parses composite steps but not arbitrary Docker action metadata", () => {
    expect(parseWorkflow("action.yml", "runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v4").findings[0].job).toBe("composite");
    expect(parseWorkflow("action.yml", "runs:\n  using: docker\n  image: Dockerfile").findings).toEqual([]);
  });
  it("reports invalid YAML and duplicate keys without leaking source contents", () => {
    for (const source of ["jobs: [", "jobs: {}\njobs: secret-value"]) {
      const result = parseWorkflow("ci.yml", source);
      expect(result.findings).toEqual([]);
      expect(result.warnings[0].code).toBe("INVALID_YAML");
      expect(result.warnings[0].message).not.toContain("secret-value");
    }
  });
  it("classifies non-string uses as unparseable and warns on malformed steps", () => {
    expect(parseWorkflow("ci.yml", workflow("      - uses: [actions/checkout@v4]\n")).findings[0].status).toBe("unparseable");
    expect(parseWorkflow("ci.yml", "jobs:\n  test:\n    steps: invalid").warnings).toHaveLength(1);
  });
  it("supports anchored steps without recursive alias traversal", () => {
    const result = parseWorkflow("ci.yml", workflow("      - &checkout\n        uses: actions/checkout@v4\n      - *checkout\n"));
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].id).not.toBe(result.findings[1].id);
  });
  it("does not execute custom YAML tags or apply merge keys", () => {
    expect(parseWorkflow("ci.yml", "jobs: !!js/function 'function() {}'").warnings[0].code).toBe("INVALID_YAML");
  });
  it("warns when merge keys could hide inherited usages", () => {
    const source = "defaults: &action\n  uses: actions/checkout@v4\njobs:\n  test:\n    steps:\n      - <<: *action";
    expect(parseWorkflow("ci.yml", source).warnings[0].code).toBe("YAML_MERGE");
  });
  it("summarizes each category without calling local or container references pinned", () => {
    const result = parseWorkflow("ci.yml", workflow(`      - uses: actions/checkout@v4\n      - uses: actions/cache@${sha}\n      - uses: ./setup\n      - uses: docker://alpine:3\n      - uses: acme/action@11bd719\n      - uses: invalid\n`));
    expect(summarize(result.findings)).toEqual({ total: 6, needsAttention: 3, pinned: 1, partial: 1, floating: 1, unparseable: 1, local: 1, docker: 1 });
  });
});
