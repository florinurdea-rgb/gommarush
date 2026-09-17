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
        // The metallic edge of the shield in the logo. The palette had navy,
        // road-blue and white but no cool grey, so marketing borders and muted
        // marks were borrowing ink at low opacity -- legible, but never
        // deliberate. These two are the only additions to the brand colours;
        // everything else above is untouched.
        steel: {
          DEFAULT: "#8C98A8",
          soft: "#E3E8EF",
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
        // A CTA needs to sit slightly above the page without a drop shadow
        // announcing itself. Tinted with the accent rather than black, so it
        // reads as the button's own light instead of a grey smudge under it.
        cta: "0 1px 2px rgba(18, 62, 150, 0.16), 0 8px 20px -6px rgba(30, 95, 217, 0.35)",
        ctaHover: "0 1px 2px rgba(18, 62, 150, 0.2), 0 10px 24px -6px rgba(30, 95, 217, 0.45)",
      },
      backgroundImage: {
        // Every gradient on this site is defined here, so "elegant" stays a
        // decision made once rather than a judgement made per component.
        // All four are deliberately near-invisible in isolation: their job is
        // to stop large flat areas reading as flat, not to be noticed.

        // Section ground: white lifting to the existing soft grey. A ~2%
        // luminance move over the full height.
        "gr-soft": "linear-gradient(180deg, #FFFFFF 0%, #F4F7FB 55%, #F6F8FB 100%)",

        // The inverted band. Angled off-axis so the light reads as coming
        // from one corner, with the darkest point bottom-right -- flat navy
        // at this size looks like a filled rectangle.
        "gr-ink": "linear-gradient(155deg, #1C2E4C 0%, #152238 52%, #101A2B 100%)",

        // Primary CTA. Light at the top edge, base colour through the middle,
        // a shade deeper at the bottom: the classic dimensional button, kept
        // to a range narrow enough that it still reads as one solid colour.
        "gr-accent": "linear-gradient(180deg, #2A6AE0 0%, #1E5FD9 52%, #1B55C6 100%)",
        "gr-accent-hover": "linear-gradient(180deg, #1E5FD9 0%, #1A55C6 52%, #123E96 100%)",

        // A hairline that fades out at both ends instead of stopping dead
        // against the page gutter. Replaces a full-width border.
        "gr-rule":
          "linear-gradient(90deg, rgba(227,232,239,0) 0%, #E3E8EF 12%, #E3E8EF 88%, rgba(227,232,239,0) 100%)",

        // A very faint accent wash for the hero, anchored top-right. At 4%
        // it is below the threshold of being seen as a colour; it just keeps
        // the corner from being dead white.
        "gr-hero":
          "radial-gradient(120% 90% at 88% 0%, rgba(30,95,217,0.055) 0%, rgba(30,95,217,0.02) 38%, rgba(255,255,255,0) 68%)",
      },
      maxWidth: {
        // 900px, unchanged: the quote form and the public order views are
        // reading-width pages and must not get wider.
        content: "900px",
        admin: "1400px",
        // The marketing surface needs room for a four-step horizontal journey
        // and a four-up value strip. Added rather than widening `content`, so
        // no existing page shifts.
        shell: "1200px",
      },
    },
  },
  plugins: [],
};
