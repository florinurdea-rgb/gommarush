import { listStandOverview } from "@/lib/server/stands";
import { PageHeading } from "@/components/logistics/AdminShell";
import { standQrUrl } from "@/lib/logistics/label";
import { appBaseUrl } from "@/lib/config";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { STAND_CODES } from "@/lib/types/logistics";
import { t } from "@/lib/i18n/logistics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coduri QR stative" };

/**
 * Printable QR stickers for the five physical stands.
 *
 * These are printed ONCE and stay on the racks forever: each encodes a fixed
 * `/stand/X` URL, and the server resolves which order is currently on that
 * stand at scan time. Changing the order never invalidates the sticker.
 */
export default async function StandsPage() {
  const stands = await listStandOverview();
  const baseUrl = appBaseUrl();

  return (
    <>
      <PageHeading
        title={t("standQrCodes")}
        description="Printează o dată și lipește pe stative. Codurile sunt permanente — nu se schimbă când se schimbă comanda."
      />

      <div className="mb-5 rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink-soft print:hidden">
        Fiecare cod duce la <code className="font-mono">{baseUrl}/stand/X</code>. La
        scanare, serverul afișează comanda aflată în acel moment pe stativ, sau
        mesajul că stativul este liber.
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {STAND_CODES.map((code) => {
          const occupant = stands.find((stand) => stand.standCode === code);
          return (
            <div
              key={code}
              className="flex break-inside-avoid flex-col items-center rounded-2xl border-2 border-ink bg-white p-5"
            >
              <div className="text-8xl font-black leading-none text-ink">{code}</div>
              <div className="mt-1 text-xs font-bold uppercase tracking-[0.3em] text-ink-soft">
                {t("stand")}
              </div>

              {/* Rendered by /api/stand-qr/[code] as an SVG. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/stand-qr/${code}`}
                alt={`Cod QR pentru stativul ${code}`}
                className="mt-4 h-44 w-44"
              />

              <div className="mt-3 break-all text-center font-mono text-[10px] text-ink-soft">
                {standQrUrl(baseUrl, code)}
              </div>

              <div className="mt-3 w-full border-t border-ink/10 pt-3 text-center text-sm print:hidden">
                {occupant?.orderId ? (
                  <>
                    <div className="font-mono text-xs text-ink-soft">
                      {formatOrderNumber(occupant.orderNumber)}
                    </div>
                    <div className="font-semibold text-ink">{occupant.customerName ?? "—"}</div>
                  </>
                ) : (
                  <span className="font-semibold text-state-success">
                    {t("standFree")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
