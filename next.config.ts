import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The docs pages are app/docs/**/page.mdx.
  pageExtensions: ["ts", "tsx", "mdx"],
};

export default createMDX()(nextConfig);
