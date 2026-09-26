"use client";
import { usePathname } from "next/navigation";

/**
 * The customer area's content width.
 *
 * The catalogue alone uses the wider shell (1200px) so the results and the
 * persistent basket rail sit side by side; every other portal page keeps the
 * 900px reading width it was designed at. Header and main use the same
 * choice, so the logo lines up with the content on every page.
 */
export function CustomerWidth({
  as: Tag = "div",
  className = "",
  children,
}: {
  as?: "div" | "main";
  className?: string;
  children: React.ReactNode;
}) {
  const wide = (usePathname() ?? "").startsWith("/account/catalogue");
  return <Tag className={`mx-auto ${wide ? "max-w-shell" : "max-w-content"} ${className}`}>{children}</Tag>;
}
