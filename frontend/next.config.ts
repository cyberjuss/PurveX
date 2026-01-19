import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Optimize compilation performance
  experimental: {
    // Tree-shake large icon libraries and chart components
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  // Reduce logging for faster builds
  logging: {
    fetches: {
      fullUrl: false,
    },
  }
};

export default nextConfig;
