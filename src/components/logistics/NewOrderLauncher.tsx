"use client";

import { useState } from "react";
import { NewOrderModal } from "@/components/logistics/NewOrderModal";
import type { OptionRef } from "@/components/logistics/NewOrderFlow";
import type { StandCode } from "@/lib/types/logistics";

/** The dashboard's "+ Comandă nouă" button, plus the modal it opens. */
export function NewOrderLauncher({
  drivers,
  vehicles,
  availableStands,
}: {
  drivers: OptionRef[];
  vehicles: OptionRef[];
  availableStands: StandCode[];
}) {
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
      {open && (
        <NewOrderModal
          drivers={drivers}
          vehicles={vehicles}
          availableStands={availableStands}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
