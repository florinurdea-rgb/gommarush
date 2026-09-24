import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export function CommerceCartIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M2.75 3.25h1.9l2.2 10.42a1.9 1.9 0 0 0 1.86 1.51h7.64a1.9 1.9 0 0 0 1.86-1.48l1.54-6.7H6.1"/><circle cx="9.75" cy="19.5" r="1.4"/><circle cx="17.25" cy="19.5" r="1.4"/></svg>;
}
export function CommerceCheckIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M5 12.5l4.5 4.5L19 7"/></svg>;
}
export function CommercePlusIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M12 5v14M5 12h14"/></svg>;
}
export function CommerceMinusIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M5 12h14"/></svg>;
}
export function CommerceSunIcon(props: IconProps) {
  return <svg {...base} {...props}><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/></svg>;
}
export function CommerceSnowflakeIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5M8.8 4.35L12 7.5l3.2-3.15M8.8 19.65L12 16.5l3.2 3.15M4.25 11.05l4.3-1.15-1.15-4.3M19.75 12.95l-4.3 1.15 1.15 4.3M4.25 12.95l4.3 1.15-1.15 4.3M19.75 11.05l-4.3-1.15 1.15-4.3"/></svg>;
}
export function CommerceAllSeasonIcon(props: IconProps) {
  return <svg {...base} {...props}><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h17"/><path d="M12 6.8a5.2 5.2 0 0 1 0 10.4M12 6.8a5.2 5.2 0 0 0 0 10.4"/></svg>;
}
export function CommerceTruckIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M3 6.5h11v10H3zM14 10h3.5l3 3v3.5H14z"/><circle cx="7" cy="18" r="1.5"/><circle cx="17.5" cy="18" r="1.5"/></svg>;
}
export function CommerceSearchIcon(props: IconProps) {
  return <svg {...base} {...props}><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>;
}
export function CommerceWarningIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M12 3.5 21 20H3L12 3.5Z"/><path d="M12 9v4.5M12 17h.01"/></svg>;
}
export function CommerceRefreshIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M20 7v5h-5"/><path d="M18.2 16.5A7.5 7.5 0 1 1 19.5 9L20 12"/></svg>;
}
export function CommerceLocationIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></svg>;
}
