const logo = "/images/logo-mark.png";

interface LogoProps {
  className?: string;
  iconClassName?: string;
  textClassName?: string;
}

// The source artwork (public/images/logo.jpg) is a square shield stacked
// above a "GommaRush" wordmark, on an opaque white background. We only want
// the shield, paired with a real text lockup -- the baked-in raster wordmark
// is too small and thin to scale up cleanly.
//
// This used to crop the shield out of that JPEG with backgroundSize: 278%.
// It worked, but a JPEG has no alpha, so the shield arrived sitting on its
// own white square: invisible against the white header, and a pale patch
// against any other ground -- clearly visible in the footer.
//
// logo-mark.png is the shield extracted from the same artwork with a real
// alpha channel, cut by flooding transparency inward from the border so that
// only background-connected white is removed and the white road markings and
// metallic shield edge INSIDE the shield are untouched. It composites onto
// any background, so the crop arithmetic is gone and `contain` is enough.
export function Logo({ className = "", iconClassName = "", textClassName = "" }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        role="img"
        aria-label="GommaRush"
        className={`h-11 w-11 flex-none bg-no-repeat sm:h-14 sm:w-14 ${iconClassName}`}
        style={{
          backgroundImage: `url(${logo})`,
          backgroundSize: "contain",
          backgroundPosition: "center",
        }}
      />
      <span className={`text-2xl font-extrabold leading-none tracking-tight sm:text-3xl ${textClassName}`}>
        <span className="text-ink">Gomma</span>
        <span className="text-accent">Rush</span>
      </span>
    </span>
  );
}
