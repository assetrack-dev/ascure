import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// next/font owns the `*-raw` vars; globals.css layers named fallbacks on top as
// --font-display / --font-body / --font-mono. Keeping the names distinct avoids
// a self-referential `--font-x: var(--font-x, …)` cycle, which resolves to empty
// and silently drops every font back to system sans.
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display-raw",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body-raw",
  display: "swap",
});

// Load 400/600 too — the design (and the ui primitives) set mono eyebrows and
// table headers at 600; with only 500/700 the browser rounds to the nearest.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono-raw",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ASCURE Admin",
  description: "ASCURE inspection operations admin console",
};

const themeScript = `(function(){try{var t=localStorage.getItem('ascure-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
