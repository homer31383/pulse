import type { Metadata, Viewport } from 'next'
import './globals.css'
import { SpeechProviderWrapper } from '@/components/SpeechProviderWrapper'
// eslint-disable-next-line @next/next/no-page-custom-font
import { Lora, Playfair_Display, Inter } from 'next/font/google'

const lora = Lora({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-lora',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-playfair',
})

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'Pulse',
  description: 'AI-powered interest channel briefings',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Pulse',
  },
  icons: {
    icon: [{ url: '/pulse-icon-192.png', type: 'image/png', sizes: '192x192' }],
    apple: '/pulse-icon-192.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#7c6fcd',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${lora.variable} ${playfair.variable} ${inter.variable} bg-cream-200 text-ink-300 antialiased font-sans`}>
        <SpeechProviderWrapper>
          {children}
        </SpeechProviderWrapper>

        {/* Register service worker */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  )
}
