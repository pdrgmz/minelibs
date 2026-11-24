/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Una sola familia de acento y una escala de forma declarada:
      // controles/badges = 8px (rounded-lg), superficies = 16px (rounded-2xl).
      colors: {
        surface: '#14171f',
        panel: '#1c202b',
        accent: '#5b8cff',
      },
    },
  },
  plugins: [],
};
