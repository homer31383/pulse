import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // react-markdown v9 and remark-gfm v4 are ESM-only;
  // transpiling ensures they work in both server and client contexts
  transpilePackages: ['react-markdown', 'remark-gfm'],

  // PDF export: pdfkit (and its fontkit) load from node_modules rather than
  // the bundle, and the embedded font files ship with the export route
  serverExternalPackages: ['pdfkit'],
  outputFileTracingIncludes: {
    '/api/channels/[id]/export': ['./lib/pdf/fonts/*.ttf'],
  },

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
