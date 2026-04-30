import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASCURE Admin",
  description: "ASCURE inspection operations admin console",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
