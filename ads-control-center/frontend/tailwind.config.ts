import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B1220",
        panel: "#121A2B",
        line: "#22304A",
        accent: "#4C8DFF",
        danger: "#E5484D",
        warn: "#F5A524",
        ok: "#30A46C",
      },
    },
  },
  plugins: [],
};

export default config;
