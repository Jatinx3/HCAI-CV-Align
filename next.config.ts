import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mupdf ships a WebAssembly build and loads it at import time; bundling it
  // breaks that, so it is required from node_modules at runtime instead.
  serverExternalPackages: ["mupdf"],
};

export default nextConfig;
