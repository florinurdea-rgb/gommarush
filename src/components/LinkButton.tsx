import { AnchorHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-dark active:scale-[0.99]",
  secondary: "bg-white text-ink border border-ink/15 hover:bg-surface-soft",
  ghost: "bg-transparent text-ink hover:bg-surface-soft",
};

const sizeClasses: Record<Size, string> = {
  md: "h-11 px-5 text-[15px]",
  lg: "h-14 px-8 text-base sm:text-lg",
};

export function LinkButton({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <a
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {children}
    </a>
  );
}
