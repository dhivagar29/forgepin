import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ForgePin — Pin your actions. Own your supply chain.",
  description: "Audit public GitHub Actions workflows for unpinned dependencies. Find floating refs, resolve full commit SHAs, and ship with confidence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
