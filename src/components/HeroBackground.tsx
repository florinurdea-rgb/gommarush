import heroTireShop from "../assets/hero-tire-shop.webp";

// Photo background of a tyre shop, faded to white on the left (behind the
// copy), and softly on the top/bottom edges, so it reads as a light,
// subtle backdrop rather than a busy full-strength photo.
export function HeroBackground() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <img
        src={heroTireShop}
        alt=""
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, #FFFFFF 0%, #FFFFFF 22%, rgba(255,255,255,0.92) 38%, rgba(255,255,255,0.62) 55%, rgba(255,255,255,0.38) 72%, rgba(255,255,255,0.24) 100%)",
        }}
      />
      {/* Text spans the full width below sm, so the photo needs a much stronger wash there to stay readable */}
      <div className="absolute inset-0 bg-white/80 sm:hidden" />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white to-transparent" />
    </div>
  );
}
