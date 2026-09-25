import {
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  Headset,
  Layers,
  MessageSquare,
  MousePointerClick,
  Phone,
  Search,
  ShieldCheck,
  Tag,
  Truck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

/**
 * The marketing site's icon vocabulary.
 *
 * One map, one library. Icons are referenced by what they MEAN here, not by
 * their Lucide name, for two reasons: a section says `icon="delivery48"`
 * rather than picking a glyph, so the same idea cannot end up as a clock in
 * one place and a van in another; and swapping the underlying glyph later is
 * one line here instead of a search across pages.
 *
 * Stroke weight is set once at the render site (1.6) rather than per icon.
 * Mixed stroke weights are the single most common reason an icon set stops
 * looking like a set.
 */
export type IconName =
  | "simple"
  | "price"
  | "delivery48"
  | "delivery7"
  | "reliable"
  | "support"
  | "find"
  | "choose"
  | "order"
  | "receive"
  | "availability"
  | "depot"
  | "message"
  | "phone"
  | "check"
  | "orders";

export const ICONS: Record<IconName, LucideIcon> = {
  simple: MousePointerClick,
  price: Tag,
  delivery48: Clock,
  delivery7: Calendar,
  reliable: ShieldCheck,
  support: Headset,
  find: Search,
  choose: CheckCircle2,
  order: MousePointerClick,
  receive: Truck,
  availability: Layers,
  depot: Warehouse,
  message: MessageSquare,
  phone: Phone,
  check: CheckCircle2,
  orders: ClipboardList,
};

export const ICON_STROKE = 1.6;

/**
 * An icon in a restrained brand-tinted container.
 *
 * The container is small and square on purpose. The brief's instruction was
 * icons inside subtle brand-coloured containers rather than large decorative
 * cards, and the difference between those two is mostly size: at 40px this
 * aids scanning, at 72px it becomes the thing you look at instead of the
 * words next to it.
 */
export function IconBadge({
  name,
  tone = "accent",
  className = "",
}: {
  name: IconName;
  tone?: "accent" | "ink" | "light";
  className?: string;
}) {
  const Glyph = ICONS[name];

  const toneClass = {
    accent: "bg-accent-light text-accent",
    ink: "bg-ink/5 text-ink",
    light: "bg-white/10 text-white",
  }[tone];

  return (
    <span
      className={`inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl ${toneClass} ${className}`}
    >
      <Glyph aria-hidden="true" className="h-[1.15rem] w-[1.15rem]" strokeWidth={ICON_STROKE} />
    </span>
  );
}

/** A bare icon, for inline use where a container would be too heavy. */
export function Icon({
  name,
  className = "h-5 w-5",
}: {
  name: IconName;
  className?: string;
}) {
  const Glyph = ICONS[name];
  return <Glyph aria-hidden="true" className={className} strokeWidth={ICON_STROKE} />;
}
