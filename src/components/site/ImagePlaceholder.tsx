import { ImageIcon } from "lucide-react";

/**
 * A placeholder standing in for photography that does not exist yet.
 *
 * The point of this component is that replacing it later changes nothing about
 * the layout. It locks an aspect ratio with `aspect-*` rather than a fixed
 * height, so the box the photograph will eventually occupy is exactly the box
 * reserved now -- no reflow, no cumulative layout shift when the real image
 * lands.
 *
 * `intent` is not decoration. It is the brief for the photograph, written into
 * the markup so whoever commissions the shoot can read it off the page, and so
 * a placeholder that survives to production says plainly what is missing
 * instead of looking like a broken image.
 */

export type PlaceholderRatio = "hero" | "wide" | "portrait" | "square" | "banner";

const RATIO_CLASS: Record<PlaceholderRatio, string> = {
  // 4:3 -- the hero composition, tall enough to hold a van and a shopfront.
  hero: "aspect-[4/3]",
  // 16:9 -- editorial band inside a section.
  wide: "aspect-[16/9]",
  // 3:4 -- a person, or a stack of tyres.
  portrait: "aspect-[3/4]",
  square: "aspect-square",
  // 21:9 -- full-width strip, e.g. depot operations.
  banner: "aspect-[21/9]",
};

interface ImagePlaceholderProps {
  /** What should eventually be photographed here. Rendered visibly. */
  intent: string;
  ratio?: PlaceholderRatio;
  className?: string;
  /** Children render on top of the placeholder, e.g. a delivery status chip. */
  children?: React.ReactNode;
}

export function ImagePlaceholder({
  intent,
  ratio = "wide",
  className = "",
  children,
}: ImagePlaceholderProps) {
  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl border border-steel-soft bg-surface-soft ${RATIO_CLASS[ratio]} ${className}`}
    >
      {/* A faint diagonal rule so an empty box reads as "reserved" rather than
          "failed to load", without becoming a decorative pattern. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.55]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, transparent 0 22px, rgba(140,152,168,0.10) 22px 23px)",
        }}
      />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-steel shadow-[0_1px_2px_rgba(21,34,56,0.06)]">
          <ImageIcon aria-hidden="true" className="h-5 w-5" strokeWidth={1.6} />
        </span>
        <p className="max-w-sm text-[13px] font-medium leading-snug text-ink-soft">{intent}</p>
      </div>

      {children}
    </div>
  );
}

/**
 * A small status chip to sit over a hero image.
 *
 * Kept deliberately plain -- two lines of real operational language, the same
 * vocabulary the platform itself uses. It is meant to read as a glimpse of the
 * service, not as a screenshot of a dashboard that does not look like this.
 */
export function OverlayStatus({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={`absolute bottom-4 left-4 right-4 rounded-xl border border-steel-soft bg-white/95 px-4 py-3 shadow-card backdrop-blur-sm sm:bottom-6 sm:left-6 sm:right-auto sm:max-w-[16rem] ${className}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">{label}</p>
      <p className="mt-0.5 text-[15px] font-bold leading-tight text-ink">{value}</p>
    </div>
  );
}
