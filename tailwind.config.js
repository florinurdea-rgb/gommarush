/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#152238",
          soft: "#4A5568",
        },
        accent: {
          DEFAULT: "#1E5FD9",
          dark: "#123E96",
          light: "#EAF1FD",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          soft: "#F6F8FB",
        },
        // Warehouse status palette. Deliberately saturated and few: an operator
        // must read state from across a room, and every extra hue costs
        // recognition speed. Each has a `soft` background pair for badges.
        state: {
          waiting: "#B45309",
          "waiting-soft": "#FEF3C7",
          progress: "#1E5FD9",
          "progress-soft": "#E0EBFC",
          success: "#15803D",
          "success-soft": "#DCFCE7",
          warning: "#C2410C",
          "warning-soft": "#FFEDD5",
          danger: "#B91C1C",
          "danger-soft": "#FEE2E2",
          neutral: "#475569",
          "neutral-soft": "#F1F5F9",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(21, 34, 56, 0.06), 0 4px 16px rgba(21, 34, 56, 0.06)",
        modal: "0 20px 60px rgba(21, 34, 56, 0.25)",
      },
      maxWidth: {
        content: "900px",
        admin: "1400px",
      },
    },
  },
  plugins: [],
};
