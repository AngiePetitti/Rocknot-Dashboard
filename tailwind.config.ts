import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        "pastel-purple": "#c4b5fd",
        "pastel-pink": "#f9a8d4",
        "pastel-yellow": "#fde68a",
        "pastel-green": "#86efac",
        "pastel-blue": "#93c5fd",
        "pastel-orange": "#fdba74",
      },
    },
  },
  plugins: [],
};
export default config;
