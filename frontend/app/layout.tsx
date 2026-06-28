import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// The codegraph type system (FR-33). Three deliberate roles, all self-hosted by
// next/font (no external CDN — keeps the strict-CSP static export same-origin):
//   · Space Grotesk — the brand/display voice: a geometric grotesque with just
//     enough technical character for an "instrument panel" identity.
//   · Inter — the UI workhorse: engineered for legibility in dense, small-type UI.
//   · JetBrains Mono — code, addresses, counts: the developer-tool signature face.
const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const sans = Inter({
  variable: "--font-sans-ui",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono-ui",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "codegraph — your codebase as a living map",
  description: "An interactive, read-only knowledge graph of your codebase.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
