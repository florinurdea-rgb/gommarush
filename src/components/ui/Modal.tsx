"use client";

import { useRef } from "react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { useFocusTrap } from "@/hooks/useFocusTrap";

/**
 * The one modal shell every dialog in the admin UI builds on — backdrop,
 * centered panel, Escape/backdrop-click to close, focus trap, scroll lock.
 * Content-agnostic on purpose: the new-order flow, the order quick-look,
 * and anything else just supply children.
 */
export function Modal({
  onClose,
  children,
  size = "md",
  label,
}: {
  onClose: () => void;
  children: React.ReactNode;
  /** sm ~ 28rem, md ~ 32rem, lg ~ 48rem, xl ~ 64rem. */
  size?: "sm" | "md" | "lg" | "xl";
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(true);
  useFocusTrap(containerRef, true, onClose);

  const sizeClass = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-3xl",
    xl: "max-w-5xl",
  }[size];

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`max-h-[90vh] w-full overflow-y-auto rounded-3xl bg-white shadow-modal outline-none ${sizeClass}`}
      >
        {children}
      </div>
    </div>
  );
}

/** Standard header for Modal content: title + close button. */
export function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink/10 bg-white/95 px-6 py-4 backdrop-blur">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Chiudi"
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft hover:bg-surface-soft hover:text-ink"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
