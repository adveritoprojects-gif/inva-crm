import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep pg and exceljs as runtime node_modules instead of bundling them.
  serverExternalPackages: ["pg", "exceljs"],
};

export default nextConfig;
