/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#E05E1A',
        secondary: '#1A2942',
        accent: '#4F46E5',
        success: '#10B981',
        warning: '#F59E0B',
        error: '#EF4444',
        bg: '#0B1220',
        card: '#101826',
        text: '#F8FAFC',
        muted: '#94A3B8',
      },
      borderRadius: {
        '2xl': '24px',
        '3xl': '32px',
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      fontFamily: {
        'space-mono': ['SpaceMono-Regular'],
      },
    },
  },
  plugins: [],
};
