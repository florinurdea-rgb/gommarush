import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { CustomerLoginForm } from "@/components/customer/CustomerLoginForm";
import { getCustomerSession } from "@/lib/auth/customer-session";

export const dynamic="force-dynamic";
export const metadata={title:"Area clienti | GommaRush"};

export default async function CustomerLoginPage(){
  if(await getCustomerSession()) redirect("/account");
  return <div className="flex min-h-screen flex-col bg-surface-soft">
    <header className="mx-auto w-full max-w-content px-4 pt-6 sm:px-6"><Link href="/"><Logo iconClassName="h-12 w-12" textClassName="text-2xl"/></Link></header>
    <main className="flex flex-1 items-center justify-center px-4 py-10"><div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-card sm:p-8">
      <h1 className="text-xl font-extrabold tracking-tight text-ink">Area clienti</h1><p className="mt-1 text-sm text-ink-soft">Accedi al tuo account GommaRush.</p><CustomerLoginForm/>
    </div></main>
  </div>;
}
