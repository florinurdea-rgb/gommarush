import heroCourier from "../assets/hero-courier.webp";

// Static illustration (courier handing a tyre to a fitting-shop worker),
// kept out of the mobile layout and faded behind a white gradient so it
// reads as a light background accent rather than competing with the copy.
export function HeroBackground() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <img
        src={heroCourier}
        alt=""
        decoding="async"
        className="absolute bottom-0 right-[-1%] hidden h-[80%] w-auto max-w-none select-none sm:block lg:right-[2%] lg:h-[86%]"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, #FFFFFF 0%, #FFFFFF 28%, rgba(255,255,255,0.88) 42%, rgba(255,255,255,0.32) 58%, rgba(255,255,255,0.05) 72%, rgba(255,255,255,0) 100%)",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white to-transparent" />
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-white to-transparent" />
    </div>
  );
}
