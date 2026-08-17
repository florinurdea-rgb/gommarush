"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { t } from "@/lib/i18n/logistics";

/**
 * Signing out clears the httpOnly cookie server-side — the browser cannot do it
 * itself, which is the point of the cookie being httpOnly.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="secondary"
      size="md"
      disabled={busy}
      className="h-9 px-3 text-sm"
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/admin/logout", { method: "POST" });
          router.replace("/admin/login");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("signOut")}
    </Button>
  );
}
