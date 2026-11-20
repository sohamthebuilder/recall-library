import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load the Postgres driver from node_modules at runtime instead of bundling it.
  serverExternalPackages: ["pg"],
  experimental: {
    // Uploads go through server actions (default limit 1 MB). Vercel caps a function's
    // request body at 4.5 MB, so larger files (big PDFs) need client uploads to Blob instead.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
};

export default nextConfig;
