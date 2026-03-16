/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: {
          bg: '#0e0f13',
          hover: '#1b1d24',
          active: '#262830',
          border: '#2b2e38',
        },
        surface: {
          DEFAULT: '#141519',
          raised: '#1b1d24',
          overlay: '#262830',
        },
        accent: {
          DEFAULT: '#d4a039',
          hover: '#e0b350',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
