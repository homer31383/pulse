import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Warm dark palette — dark brown-charcoal tones replacing cold slate
        warm: {
          50:  '#faf7f4',
          100: '#f2ede6',
          200: '#e0d8ce',
          300: '#c9bfb3',
          400: '#a99b91',
          500: '#7d7068',
          600: '#57504a',
          700: '#3a342f',
          800: '#272220',
          900: '#1a1714',
          950: '#100e0c',
        },
        // Brand accent — warm indigo / soft violet
        brand: {
          50:  '#f3f0ff',
          100: '#e9e4fe',
          200: '#d4ccfc',
          300: '#b4a9f8',
          400: '#9482f2',
          500: '#7c6fcd',
          600: '#6355b0',
          700: '#4d4190',
          800: '#3b3070',
          900: '#2c2455',
          950: '#1c1637',
        },
      },
      fontFamily: {
        serif: ['var(--font-lora)', 'Georgia', 'Cambria', 'serif'],
      },
      animation: {
        'pulse-dot': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [typography],
}

export default config
