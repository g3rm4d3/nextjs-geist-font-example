import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Admin app never bundles or executes financial/ride business logic —
  // it only calls the authoritative API. See docs/architecture.md.
};

export default nextConfig;
