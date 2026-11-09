import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        chalkboard: {
          bg: "#1a2e26",      // Classic deep green chalkboard
          dark: "#12201b",
          light: "#264237",
          border: "#34594a",
          chalk: "#f5f5f0",
          yellow: "#fef08a",
          cyan: "#a5f3fc",
          pink: "#fbcfe8",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
