import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { formats: ["image/avif", "image/webp"] },
  // The repo root has its own lockfile (Expo app); pin the workspace root here.
  turbopack: { root: __dirname },
};

export default nextConfig;
