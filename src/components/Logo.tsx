import logo from "../assets/logo.jpg";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <img
      src={logo}
      alt="GoRush"
      className={`h-10 w-auto object-contain sm:h-11 ${className}`}
    />
  );
}
