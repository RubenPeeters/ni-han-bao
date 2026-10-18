import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  cacheLife: {
    // Stat pages: Supabase is read at most about once a minute per guild and page.
    stats: { stale: 60, revalidate: 60, expire: 3600 },
  },
};

export default nextConfig;
