import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // react-markdown v9 and remark-gfm v4 are ESM-only;
  // transpiling ensures they work in both server and client contexts
  transpilePackages: ['react-markdown', 'remark-gfm'],

  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ]
  },
}

export default nextConfig
