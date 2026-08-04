/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./get-offer/index.html", "./src/**/*.{ts,tsx}"],
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
      },
      boxShadow: {
        card: "0 1px 2px rgba(21, 34, 56, 0.06), 0 4px 16px rgba(21, 34, 56, 0.06)",
        modal: "0 20px 60px rgba(21, 34, 56, 0.25)",
      },
      maxWidth: {
        content: "900px",
      },
    },
  },
  plugins: [],
};
