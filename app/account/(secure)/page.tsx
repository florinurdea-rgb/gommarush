import { getCurrentCustomerAccount } from "@/lib/server/customer-account";
import { getTr } from "@/lib/i18n/tr-server";
export default async function AccountPage(){
 const tr=getTr();
 const {customer,locations}=await getCurrentCustomerAccount();
 return <div><h1 className="text-2xl font-extrabold text-ink">{tr("Account")}</h1><div className="mt-6 rounded-2xl bg-white p-6 shadow-card"><h2 className="font-bold text-ink">{customer.legal_name||customer.name}</h2>{customer.vat_number&&<p className="mt-1 text-sm text-ink-soft">P. IVA {customer.vat_number}</p>}<p className="mt-4 text-sm text-ink-soft">{tr("Sedi di consegna")}: {locations.length}</p></div></div>;
}
