/**
 * The shopping-cart mark used by the basket link and the add-to-basket toast.
 *
 * Deliberately the ordinary cart every shop uses — a handle, a basket body and
 * two wheels — rather than anything clever. A customer must recognise it
 * without reading the label beside it, and an unfamiliar glyph in that
 * position costs exactly the recognition the icon was added to buy.
 *
 * Stroked with `currentColor`, so it inherits the colour of whatever it sits
 * in: ink in the navigation, white on the toast.
 */
export function CartIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.75 3.25h1.9l2.2 10.42a1.9 1.9 0 0 0 1.86 1.51h7.64a1.9 1.9 0 0 0 1.86-1.48l1.54-6.7H6.1" />
      <circle cx="9.75" cy="19.5" r="1.4" />
      <circle cx="17.25" cy="19.5" r="1.4" />
    </svg>
  );
}
