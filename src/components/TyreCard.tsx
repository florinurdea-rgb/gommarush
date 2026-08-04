import { SEASON_LABELS, Tyre } from "../lib/types";

interface TyreCardProps {
  tyre: Tyre;
  onEdit: () => void;
  onDelete: () => void;
}

export function TyreCard({ tyre, onEdit, onDelete }: TyreCardProps) {
  const size = `${tyre.width}/${tyre.profile} R${tyre.rim}`;
  const markings = [
    tyre.extraLoad ? { code: "XL", label: "Extra Load" } : null,
    tyre.commercial ? { code: "C", label: "Commerciale" } : null,
  ].filter((m): m is { code: string; label: string } => m !== null);

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-ink/10 bg-white p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-bold text-ink">{size}</p>
          {markings.map((m) => (
            <span
              key={m.code}
              title={m.label}
              aria-label={m.label}
              className="rounded-full border border-accent/30 bg-accent-light px-2 py-0.5 text-xs font-semibold text-accent-dark"
            >
              {m.code}
            </span>
          ))}
        </div>
        <p className="mt-0.5 text-sm text-ink-soft">
          {tyre.season ? SEASON_LABELS[tyre.season] : "—"} &middot; Quantit&agrave;: {tyre.quantity}
        </p>
        {tyre.notes ? (
          <p className="mt-0.5 text-sm text-ink-soft">Preferenza: {tyre.notes}</p>
        ) : null}
      </div>
      <div className="flex flex-none items-center gap-2 self-start sm:self-center">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Modifica pneumatico ${size}`}
          className="flex h-10 items-center gap-1.5 rounded-lg border border-ink/15 px-3 text-sm font-semibold text-ink hover:bg-surface-soft"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path
              d="M13.5 3.5l3 3L6.5 16.5H3.5v-3L13.5 3.5z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          Modifica
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Elimina pneumatico ${size}`}
          className="flex h-10 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path
              d="M4 6h12M8 6V4.5A1.5 1.5 0 019.5 3h1A1.5 1.5 0 0112 4.5V6m-6.5 0l.6 9.4a1.5 1.5 0 001.5 1.6h3.8a1.5 1.5 0 001.5-1.6L14.5 6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Elimina
        </button>
      </div>
    </li>
  );
}
