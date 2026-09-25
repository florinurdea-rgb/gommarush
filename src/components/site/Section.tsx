/**
 * Layout primitives for the marketing surface.
 *
 * These exist so vertical rhythm, measure and gutters are decided once. The
 * previous marketing page set padding per section, which is how a site ends up
 * with four slightly different section heights that nobody chose.
 *
 * Two rules they enforce:
 *
 *  - Side padding lives here and only here, set as `px-*` on the inner shell,
 *    so no section can accidentally lose its gutter on a narrow phone.
 *  - Background changes are a `tone`, not a free-form class. Alternating
 *    white and `surface-soft` is what separates sections on this site; giving
 *    callers an open `className` for backgrounds is how that becomes six
 *    competing tints.
 */

export type SectionTone = "white" | "soft" | "ink";

const TONE_CLASS: Record<SectionTone, string> = {
  white: "bg-white",
  // Gradient rather than flat: these are the two largest uninterrupted areas
  // on the page, and a ~2% luminance drift is the difference between a
  // section that has air in it and one that reads as a printed band. The
  // gradients themselves live in tailwind.config.js.
  soft: "bg-gr-soft",
  // Inverted band, used sparingly -- the final conversion block and the
  // supplier hero. More than twice on a page and it stops carrying weight.
  ink: "bg-gr-ink text-white",
};

interface SectionProps {
  id?: string;
  tone?: SectionTone;
  /** Hairline divider above. Off by default: a tone change usually says enough. */
  bordered?: boolean;
  /** Tighter vertical rhythm, for strips rather than full sections. */
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
  as?: "section" | "div" | "footer" | "header";
  /**
   * Declared and forwarded explicitly. JSX lets an `aria-*` attribute be
   * passed to a component without a type error even when the component has no
   * such prop, so an undeclared one is dropped silently -- which turns a
   * visually-hidden section heading into a heading that labels nothing.
   */
  "aria-labelledby"?: string;
}

export function Section({
  id,
  tone = "white",
  bordered = false,
  compact = false,
  className = "",
  children,
  as: Tag = "section",
  "aria-labelledby": ariaLabelledBy,
}: SectionProps) {
  return (
    <Tag
      id={id}
      aria-labelledby={ariaLabelledBy}
      className={`relative ${TONE_CLASS[tone]} ${className}`}
    >
      {/*
        A hairline that fades at both ends rather than a full-bleed border
        butting into the viewport edge. Drawn as an element because a
        border-image gradient cannot be expressed as a Tailwind border.
      */}
      {bordered && (
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gr-rule" />
      )}
      <div
        className={`mx-auto w-full max-w-shell px-4 sm:px-6 lg:px-8 ${
          compact ? "py-10 sm:py-12" : "py-16 sm:py-20 lg:py-24"
        }`}
      >
        {children}
      </div>
    </Tag>
  );
}

/**
 * A section's heading block: optional eyebrow, a heading, optional lede.
 *
 * `level` is a real prop rather than a hardcoded h2 because heading order is
 * an accessibility requirement, not a styling choice -- a section inside a
 * page whose h1 is the hero needs h2, and a sub-block inside that needs h3.
 * The visual size is set separately from the level for exactly that reason.
 */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  level = 2,
  align = "left",
  size = "lg",
  tone = "dark",
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  level?: 1 | 2 | 3;
  align?: "left" | "center";
  size?: "md" | "lg" | "xl";
  tone?: "dark" | "light";
}) {
  const Tag = `h${level}` as "h1" | "h2" | "h3";

  const sizeClass = {
    md: "text-2xl sm:text-3xl",
    lg: "text-3xl sm:text-4xl",
    xl: "text-4xl sm:text-5xl lg:text-[3.25rem]",
  }[size];

  const alignClass = align === "center" ? "text-center mx-auto" : "";

  return (
    <div className={`max-w-2xl ${alignClass}`}>
      {eyebrow && (
        <p
          className={`text-[12px] font-bold uppercase tracking-[0.12em] ${
            tone === "light" ? "text-accent-light" : "text-accent"
          }`}
        >
          {eyebrow}
        </p>
      )}
      <Tag
        className={`text-balance font-extrabold leading-[1.1] tracking-[-0.02em] ${sizeClass} ${
          eyebrow ? "mt-3" : ""
        } ${tone === "light" ? "text-white" : "text-ink"}`}
      >
        {title}
      </Tag>
      {lede && (
        <p
          className={`mt-4 text-[17px] leading-relaxed sm:text-lg ${
            tone === "light" ? "text-white/75" : "text-ink-soft"
          }`}
        >
          {lede}
        </p>
      )}
    </div>
  );
}

/**
 * The shared button surface for every public CTA.
 *
 * Centralised because CTA prominence is the one thing a marketing site cannot
 * afford to be inconsistent about, and because the focus ring and the 44px
 * minimum touch target then hold everywhere by construction rather than by
 * each caller remembering.
 */
const BUTTON_BASE =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-bold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/*
  THE PRIMARY CTA IS THE SAME BUTTON AS THE COMMERCE PRIMARY.

  It used to be the `gr-accent` gradient with a tinted lift shadow, while the
  customer area's primary was a flat `bg-accent`. It is the single most-seen
  element on the site and it changed appearance at exactly the moment a
  customer crossed from the public pages into their account — which is the
  discontinuity this pass exists to remove. Flat accent, no lift, matching
  src/components/Button.tsx.

  The gradient tokens stay in tailwind.config.js: `gr-ink` and the section
  grounds still use theirs, and nothing else about the marketing palette moves.
*/
export const BUTTON_STYLES = {
  primary: `${BUTTON_BASE} bg-accent text-white hover:bg-accent-dark focus-visible:ring-accent`,
  secondary: `${BUTTON_BASE} border border-steel text-ink hover:border-accent hover:text-accent focus-visible:ring-accent`,
  onInk: `${BUTTON_BASE} bg-white text-ink hover:bg-accent-light focus-visible:ring-white focus-visible:ring-offset-ink`,
  ghostOnInk: `${BUTTON_BASE} border border-white/30 text-white hover:border-white hover:bg-white/10 focus-visible:ring-white focus-visible:ring-offset-ink`,
} as const;
