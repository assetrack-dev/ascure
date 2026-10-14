import type { MetadataRoute } from "next";

/**
 * "Add to Home Screen" for the console (plan §19, N56). An iPhone only accepts
 * Web Push from an installed home-screen app, and on Android it gives TNB a
 * one-tap icon. /login forwards a signed-in user to their own landing page.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ASCURE Admin Console",
    short_name: "ASCURE",
    description: "ASCURE inspection and maintenance console",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#2563eb",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
