import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        studio: {
          bg:        '#0d0e12',
          surface:   '#13151c',
          elevated:  '#1a1d27',
          border:    '#252836',
          muted:     '#2e3248',
          accent:    '#7c6aff',
          'accent-dim': '#4e3fc0',
          'accent-glow': '#a78bfa',
          tag:       '#22d3ee',
          nl:        '#4ade80',
          mixed:     '#fb923c',
          unknown:   '#6b7280',
          danger:    '#f87171',
          warn:      '#fbbf24',
          success:   '#34d399',
        },
      },
      fontFamily: {
        sans:  ['"DM Sans"', 'sans-serif'],
        mono:  ['"JetBrains Mono"', 'monospace'],
        display: ['"Space Grotesk"', 'sans-serif'],
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.25s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:   { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.5' } },
      },
    },
  },
  plugins: [],
} satisfies Config
