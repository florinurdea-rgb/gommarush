"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
export function CustomerSignOutButton(){
 const router=useRouter(); const [busy,setBusy]=useState(false);
 return <Button variant="secondary" size="md" disabled={busy} onClick={async()=>{setBusy(true);try{await fetch("/api/account/logout",{method:"POST"});router.replace("/account/login");router.refresh();}finally{setBusy(false);}}}>{busy?"…":"Esci"}</Button>;
}
