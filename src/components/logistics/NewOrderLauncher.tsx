"use client";

import { useState } from "react";
import { NewOrderModal } from "@/components/logistics/NewOrderModal";

/** The dashboard's "+ Comandă nouă" button, plus the modal it opens. */
export function NewOrderLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-accent px-8 text-base font-semibold text-white transition-all duration-150 hover:bg-accent-dark active:scale-[0.99] sm:text-lg"
      >
        + Comandă nouă
      </button>
      {open && <NewOrderModal onClose={() => setOpen(false)} />}
    </>
  );
}
