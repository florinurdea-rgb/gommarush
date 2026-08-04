import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /**
   * Muted styling only, no aria-disabled: the button still performs a real
   * action on click (reveal validation errors, focus the first invalid
   * field), so it must stay genuinely operable for mouse, keyboard, and AT.
   */
  visuallyDisabled?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-dark active:bg-accent-dark active:scale-[0.99] disabled:bg-ink/20 disabled:text-ink/40",
  secondary:
    "bg-white text-ink border border-ink/15 hover:bg-surface-soft active:bg-surface-soft disabled:text-ink/30",
  danger:
    "bg-white text-red-700 border border-red-200 hover:bg-red-50 active:bg-red-100",
  ghost: "bg-transparent text-ink hover:bg-surface-soft active:bg-surface-soft",
};

const mutedClasses = "bg-ink/10 text-ink/40 hover:bg-ink/10 active:bg-ink/10";

const sizeClasses: Record<Size, string> = {
  md: "h-11 px-5 text-[15px]",
  lg: "h-14 px-8 text-base sm:text-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "md", visuallyDisabled = false, className = "", children, ...rest },
    ref
  ) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
          visuallyDisabled ? `${mutedClasses} cursor-not-allowed` : variantClasses[variant]
        } ${sizeClasses[size]} ${className}`}
        {...rest}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
