import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load the Postgres driver from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
