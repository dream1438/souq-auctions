import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Photo uploads (ID documents, listing photos) are resized in the browser first; this is the ceiling for one form.
    serverActions: { bodySizeLimit: "8mb" },
    // Almost every page depends on who is signed in and on live prices, so pages stream behind
    // loading.tsx instead of being instant. Only check instant navigation where a page opts in.
    instantInsights: { validationLevel: "manual-warning" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
