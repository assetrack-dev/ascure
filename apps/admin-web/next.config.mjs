/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Web Push service worker (plan §19, N56): never cached, so a deploy's new
  // worker is picked up at once; allowed to control the whole console.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
