import type { NextConfig } from "next";

const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
const fallbackTimestamp = String(Date.now());
const buildVersion = commitSha || process.env.NEXT_PUBLIC_APP_VERSION || fallbackTimestamp;

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: buildVersion,
  },
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
