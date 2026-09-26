import { CommerceCheckIcon, CommerceRefreshIcon, CommerceWarningIcon } from "@/components/customer/CommerceIcons";

/**
 * An order's state, as one pill.
 *
 * The four labels are the existing ones and are not rewritten here; what is
 * new is that each carries a tone and a mark, so a customer scanning a list
 * can tell "in attesa" from "rifiutato" without reading either.
 */
const STATUS: Record<
  string,
  { label: string; className: string; Icon: (p: { className?: string }) => JSX.Element }
> = {
  requested: {
    label: "In attesa di conferma",
    className: "bg-state-waiting-soft text-state-waiting",
    Icon: CommerceRefreshIcon,
  },
  confirmed: {
    label: "Confermato",
    className: "bg-state-success-soft text-state-success",
    Icon: CommerceCheckIcon,
  },
  pending_payment: {
    label: "In attesa di pagamento",
    className: "bg-state-warning-soft text-ink",
    Icon: CommerceRefreshIcon,
  },
  rejected: {
    label: "Rifiutato",
    className: "bg-state-danger-soft text-state-danger",
    Icon: CommerceWarningIcon,
  },
  cancelled: {
    label: "Annullato",
    className: "bg-state-neutral-soft text-state-neutral",
    Icon: CommerceWarningIcon,
  },
};

export function OrderStatusTag({ status, tr }: { status: string; tr: (t: string) => string }) {
  const meta = STATUS[status];
  // An unknown status shows its raw value rather than being mapped to a
  // reassuring default — inventing "Confermato" for a state nobody recognises
  // is how a customer is told the wrong thing with confidence.
  if (!meta) {
    return (
      <span className="inline-flex items-center rounded-md bg-state-neutral-soft px-2 py-0.5 text-[11px] font-bold text-state-neutral">
        {status}
      </span>
    );
  }
  const { Icon } = meta;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${meta.className}`}
    >
      <Icon className="h-3 w-3" />
      {tr(meta.label)}
    </span>
  );
}
