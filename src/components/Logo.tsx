const logo = "/images/logo.jpg";

interface LogoProps {
  className?: string;
  iconClassName?: string;
  textClassName?: string;
}

// The source artwork is a square shield icon stacked above a "GommaRush"
// wordmark. We only use the shield here (cropped out via background
// positioning) and pair it with a real text lockup at a legible size,
// since the baked-in raster wordmark is too small/thin to scale up cleanly.
export function Logo({ className = "", iconClassName = "", textClassName = "" }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        role="img"
        aria-label="GommaRush"
        className={`h-11 w-11 flex-none bg-no-repeat sm:h-14 sm:w-14 ${iconClassName}`}
        style={{
          backgroundImage: `url(${logo})`,
          backgroundSize: "278%",
          backgroundPosition: "50% 34%",
        }}
      />
      <span className={`text-2xl font-extrabold leading-none tracking-tight sm:text-3xl ${textClassName}`}>
        <span className="text-ink">Gomma</span>
        <span className="text-accent">Rush</span>
      </span>
    </span>
  );
}
