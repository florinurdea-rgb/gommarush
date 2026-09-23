"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { useTr } from "@/lib/i18n/tr";
export function CustomerSignOutButton(){
 const tr=useTr(); const router=useRouter(); const [busy,setBusy]=useState(false);
 return <Button variant="secondary" size="md" disabled={busy} onClick={async()=>{setBusy(true);try{await fetch("/api/account/logout",{method:"POST"});router.replace("/account/login");router.refresh();}finally{setBusy(false);}}}>{busy?"…":tr("Esci")}</Button>;
}
