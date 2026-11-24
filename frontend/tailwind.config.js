/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#14171f',
        panel: '#1c202b',
        accent: '#5b8cff',
      },
    },
  },
  plugins: [],
};
