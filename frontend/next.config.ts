import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Optimize compilation performance
  experimental: {
    // Tree-shake large icon libraries and chart components
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  turbopack: {
    // Avoid workspace root ambiguity when multiple lockfiles exist.
    root: process.cwd(),
  },
  // Reduce logging for faster builds
  logging: {
    fetches: {
      fullUrl: false,
    },
  }
};

export default nextConfig;
