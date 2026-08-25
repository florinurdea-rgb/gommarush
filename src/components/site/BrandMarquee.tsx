import { useId } from "react";

/**
 * The tyre brands GommaRush supplies, as continuously scrolling rows.
 *
 * Two rows on tablet and desktop, four on mobile — the same 27 logos, split
 * differently so each one stays large enough to recognise on a phone. A
 * brand strip that has to be squinted at proves nothing.
 *
 * The loop is pure CSS: each track holds the list twice and translates by
 * exactly -50%, so the moment the first copy has fully left, the second is
 * sitting precisely where the first started and the jump back is invisible.
 * No JavaScript, no cloned nodes at runtime, nothing to re-measure on
 * resize.
 *
 * Rows alternate direction. Every row sliding the same way reads as one
 * sheet of images dragged sideways; opposing directions read as a set of
 * independent belts, which is the intent.
 */

interface Brand {
  slug: string;
  name: string;
}

/** Alphabetical, so adding a brand has an obvious insertion point. */
const BRANDS: Brand[] = [
  { slug: "accelera", name: "Accelera" },
  { slug: "avon", name: "Avon Tyres" },
  { slug: "banoze", name: "Banoze" },
  { slug: "bfgoodrich", name: "BFGoodrich" },
  { slug: "bridgestone", name: "Bridgestone" },
  { slug: "churchill", name: "Churchill Tyres" },
  { slug: "continental", name: "Continental" },
  { slug: "davanti", name: "Davanti Tyres" },
  { slug: "dunlop", name: "Dunlop" },
  { slug: "firestone", name: "Firestone" },
  { slug: "general-tire", name: "General Tire" },
  { slug: "goodyear", name: "Goodyear" },
  { slug: "hankook", name: "Hankook" },
  { slug: "hifly", name: "Hifly" },
  { slug: "laufenn", name: "Laufenn" },
  { slug: "maxxis", name: "Maxxis" },
  { slug: "michelin", name: "Michelin" },
  { slug: "nankang", name: "Nankang" },
  { slug: "nexen", name: "Nexen Tire" },
  { slug: "pirelli", name: "Pirelli" },
  { slug: "radar", name: "Radar Tires" },
  { slug: "rapid", name: "Rapid" },
  { slug: "roadstone", name: "Roadstone" },
  { slug: "roadx", name: "RoadX" },
  { slug: "toyo", name: "Toyo Tires" },
  { slug: "uniroyal", name: "Uniroyal" },
  { slug: "yokohama", name: "Yokohama" },
];

/** Splits into `count` near-equal chunks, keeping the original order. */
function chunk<T>(items: T[], count: number): T[][] {
  const out: T[][] = Array.from({ length: count }, () => []);
  items.forEach((item, index) => out[index % count].push(item));
  return out;
}

function Logo({ brand }: { brand: Brand }) {
  return (
    <li className="flex flex-none items-center justify-center px-5 sm:px-7">
      <img
        src={`/images/brands/${brand.slug}.png`}
        alt={brand.name}
        loading="lazy"
        decoding="async"
        className="h-7 w-auto max-w-[130px] object-contain sm:h-9 sm:max-w-[160px]"
      />
    </li>
  );
}

function Row({
  brands,
  reverse,
  seconds,
}: {
  brands: Brand[];
  reverse: boolean;
  seconds: number;
}) {
  const id = useId();

  return (
    <div className="gr-marquee" style={{ ["--gr-duration" as string]: `${seconds}s` }}>
      <ul
        className={`gr-marquee-track ${reverse ? "gr-marquee-track--reverse" : ""}`}
        // The second copy is decorative repetition; without aria-hidden a
        // screen reader would read all 27 brands twice.
        aria-label="Marche di pneumatici fornite"
      >
        {brands.map((brand) => (
          <Logo key={`${id}-a-${brand.slug}`} brand={brand} />
        ))}
      </ul>
      <ul className={`gr-marquee-track ${reverse ? "gr-marquee-track--reverse" : ""}`} aria-hidden="true">
        {brands.map((brand) => (
          <Logo key={`${id}-b-${brand.slug}`} brand={brand} />
        ))}
      </ul>
    </div>
  );
}

export function BrandMarquee() {
  const twoRows = chunk(BRANDS, 2);
  const fourRows = chunk(BRANDS, 4);

  return (
    <section aria-labelledby="brands-title" className="border-t border-ink/10 bg-white">
      <div className="mx-auto w-full max-w-content px-4 pb-6 pt-10 sm:px-6 sm:pb-8 sm:pt-14">
        <h2
          id="brands-title"
          className="text-center text-xs font-bold uppercase tracking-[0.16em] text-ink-soft"
        >
          Le marche che forniamo
        </h2>
      </div>

      {/* Full-bleed: the belts run edge to edge, so they are not boxed by the
          content column the rest of the page uses. */}
      <div className="gr-marquee-viewport pb-12 sm:pb-16">
        {/* Mobile: four rows, so each logo keeps a usable size. */}
        <div className="space-y-5 sm:hidden">
          {fourRows.map((brands, index) => (
            <Row key={`m-${index}`} brands={brands} reverse={index % 2 === 1} seconds={38 + index * 5} />
          ))}
        </div>

        {/* Tablet and desktop: two rows, twice as many logos each. */}
        <div className="hidden space-y-7 sm:block">
          {twoRows.map((brands, index) => (
            <Row key={`d-${index}`} brands={brands} reverse={index % 2 === 1} seconds={58 + index * 8} />
          ))}
        </div>
      </div>
    </section>
  );
}
