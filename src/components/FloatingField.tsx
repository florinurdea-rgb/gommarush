import {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  forwardRef,
  useId,
  useState,
} from "react";

interface BaseProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

interface FloatingInputProps
  extends BaseProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {}

export const FloatingInput = forwardRef<HTMLInputElement, FloatingInputProps>(
  ({ label, error, hint, required, className = "", value, onFocus, onBlur, ...rest }, ref) => {
    const id = useId();
    const errorId = `${id}-error`;
    const [focused, setFocused] = useState(false);
    const hasValue = value !== undefined && value !== null && String(value).length > 0;
    const floated = focused || hasValue;

    return (
      <div className={`w-full ${className}`}>
        <div
          className={`relative rounded-xl border bg-white transition-colors ${
            error ? "border-red-400" : focused ? "border-accent" : "border-ink/15"
          }`}
        >
          <input
            ref={ref}
            id={id}
            value={value}
            aria-required={required}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
            className="peer h-[60px] w-full rounded-xl bg-transparent px-4 pt-5 pb-1.5 text-base text-ink outline-none placeholder-transparent"
            placeholder={rest.placeholder ?? label}
            {...rest}
          />
          <label
            htmlFor={id}
            className={`pointer-events-none absolute left-4 transition-all duration-150 ${
              floated
                ? "top-2 text-xs text-ink-soft"
                : "top-1/2 -translate-y-1/2 text-base text-ink-soft"
            }`}
          >
            {label}
            {required ? <span className="text-accent"> *</span> : null}
          </label>
        </div>
        {error ? (
          <p id={errorId} role="alert" className="mt-1.5 flex items-center gap-1 text-sm text-red-600">
            {error}
          </p>
        ) : hint ? (
          <p className="mt-1.5 text-sm text-ink-soft">{hint}</p>
        ) : null}
      </div>
    );
  }
);
FloatingInput.displayName = "FloatingInput";

interface FloatingSelectProps
  extends BaseProps,
    Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  children: ReactNode;
}

export function FloatingSelect({
  label,
  error,
  hint,
  required,
  className = "",
  children,
  ...rest
}: FloatingSelectProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className={`w-full ${className}`}>
      <div
        className={`relative rounded-xl border bg-white transition-colors ${
          error ? "border-red-400" : "border-ink/15 focus-within:border-accent"
        }`}
      >
        <label htmlFor={id} className="absolute left-4 top-2 text-xs text-ink-soft">
          {label}
          {required ? <span className="text-accent"> *</span> : null}
        </label>
        <select
          id={id}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className="h-[60px] w-full appearance-none rounded-xl bg-transparent px-4 pt-5 pb-1.5 text-base text-ink outline-none"
          {...rest}
        >
          {children}
        </select>
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft"
          viewBox="0 0 20 20"
          fill="none"
        >
          <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-sm text-ink-soft">{hint}</p>
      ) : null}
    </div>
  );
}

interface FloatingTextareaProps
  extends BaseProps,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {}

export function FloatingTextarea({
  label,
  error,
  hint,
  required,
  className = "",
  value,
  onFocus,
  onBlur,
  ...rest
}: FloatingTextareaProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const hasValue = value !== undefined && value !== null && String(value).length > 0;
  const floated = focused || hasValue;

  return (
    <div className={`w-full ${className}`}>
      <div
        className={`relative rounded-xl border bg-white transition-colors ${
          error ? "border-red-400" : focused ? "border-accent" : "border-ink/15"
        }`}
      >
        <textarea
          id={id}
          value={value}
          aria-required={required}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          rows={3}
          className="peer w-full resize-none rounded-xl bg-transparent px-4 pb-2 pt-6 text-base text-ink outline-none placeholder-transparent"
          placeholder={rest.placeholder ?? label}
          {...rest}
        />
        <label
          htmlFor={id}
          className={`pointer-events-none absolute left-4 transition-all duration-150 ${
            floated ? "top-2 text-xs text-ink-soft" : "top-4 text-base text-ink-soft"
          }`}
        >
          {label}
        </label>
      </div>
      {hint ? <p className="mt-1.5 text-sm text-ink-soft">{hint}</p> : null}
    </div>
  );
}
