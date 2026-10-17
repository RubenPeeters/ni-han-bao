import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  images: {
    // member avatars on the leaderboard
    remotePatterns: [new URL("https://cdn.discordapp.com/**")],
  },
};

export default nextConfig;
