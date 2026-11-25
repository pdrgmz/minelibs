/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Neo-brutalismo técnico: una sola tinta, superficies de papel y un verde de instrumento.
      colors: {
        canvas: '#EAECE4',
        surface: '#E1E3DA',
        paper: '#F2F4EC',
        ink: '#141514',
        muted: '#5C5F58',
        dash: '#8C9087',
        accent: '#00E676',
        amber: '#C68B00',
        terracotta: '#C93B3B',
        lavender: '#A78BFA',
        terminal: '#161716',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Space Mono"', '"IBM Plex Mono"', '"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['Inter', '"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        control: '8px',
        surface: '16px',
      },
    },
  },
  plugins: [],
};
