import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // Keep TypeScript 5 on its compiler API; the CLI path targets newer compilers.
  experimental: { useTypeScriptCli: false },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }];
  },
};
export default config;
