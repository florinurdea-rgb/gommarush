const heroVanFleet = "/images/hero-van-fleet.webp";

// Photo background of the branded GommaRush delivery fleet, faded to
// white on the left (behind the copy), and softly on the top/bottom
// edges, so it reads as a light, subtle backdrop rather than a busy
// full-strength photo.
//
// The wash stays near-opaque out to ~48% because the hero's h2 is a full
// sentence, not a short line: the copy has to stay legible where it crosses
// the vans, and the photo is decoration.
export function HeroBackground() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <img
        src={heroVanFleet}
        alt=""
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, #FFFFFF 0%, #FFFFFF 30%, rgba(255,255,255,0.94) 48%, rgba(255,255,255,0.7) 64%, rgba(255,255,255,0.42) 80%, rgba(255,255,255,0.24) 100%)",
        }}
      />
      {/* Text spans the full width below sm, so the photo needs a much stronger wash there to stay readable */}
      <div className="absolute inset-0 bg-white/80 sm:hidden" />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white to-transparent" />
    </div>
  );
}
