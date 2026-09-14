// Bundled, deliberately mixed sample. This is not a scan of the current actions/checkout repository.
export const demoWorkflows: Record<string, string> = {
  ".github/workflows/ci.yml": `name: Continuous integration
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Check out source
        uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
      - name: Install dependencies
        run: npm ci
      - name: Restore cache
        uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684
      - name: Local project setup
        uses: ./.github/actions/setup
      - name: Run tests
        run: npm test
`,
  ".github/workflows/release.yml": `name: Release
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - name: Check out source
        uses: actions/checkout@11bd719
      - name: Publish release
        uses: softprops/action-gh-release@v2
      - name: Container step
        uses: docker://alpine:3.20
`,
  ".github/actions/setup/action.yml": `name: Project setup
runs:
  using: composite
  steps:
    - name: Upload build artifact
      uses: actions/upload-artifact@v4
    - name: Prepare workspace
      run: echo "Ready"
      shell: bash
`,
};

// Fixed fixture mappings, never presented as live tag resolutions.
export const demoShas: Record<string, string> = {
  "actions/checkout@v4": "11bd71901bbe5b1630ceea73d27597364c9af683",
  "actions/checkout@11bd719": "11bd71901bbe5b1630ceea73d27597364c9af683",
  "actions/setup-node@v4": "49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/upload-artifact@v4": "ea165f8d65b6e75b540449e92b4886f43607fa02",
  "softprops/action-gh-release@v2": "da05d552573ad5aba039eaac05058a918a7bf631",
};
