import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { CustomerSignOutButton } from "@/components/customer/CustomerSignOutButton";
import { getCustomerSession } from "@/lib/auth/customer-session";
export const dynamic="force-dynamic";
export default async function CustomerLayout({children}:{children:React.ReactNode}){
 const session=await getCustomerSession(); if(!session) redirect("/account/login");
 return <div className="min-h-screen bg-surface-soft"><header className="border-b border-ink/10 bg-white"><div className="mx-auto flex max-w-content items-center justify-between px-4 py-4 sm:px-6"><Link href="/account"><Logo iconClassName="h-9 w-9" textClassName="text-xl"/></Link><nav className="flex items-center gap-4 text-sm font-semibold"><Link href="/account/catalogue">Catalogo</Link><Link href="/account/orders">Ordini</Link><Link href="/account">Account</Link><CustomerSignOutButton/></nav></div></header><main className="mx-auto max-w-content px-4 py-8 sm:px-6">{children}</main></div>;
}
