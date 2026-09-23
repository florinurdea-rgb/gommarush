import { getCurrentCustomerAccount } from "@/lib/server/customer-account";
import { CustomerCheckout } from "@/components/customer/CustomerCheckout";
import { isDeliverableLocation } from "@/lib/commerce/delivery-address";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const { locations } = await getCurrentCustomerAccount();

  // A courtesy filter: it stops a customer choosing a placeholder address that
  // would be refused anyway. The enforcement is server-side in
  // createPortalSalesOrder, which applies the SAME function — this list cannot
  // be the control, because the id it renders is posted back by the browser.
  const deliverable = locations.filter(isDeliverableLocation);

  return (
    <CustomerCheckout
      locations={deliverable.map((l) => ({
        id: l.id,
        location_name: l.location_name,
        address_line1: l.address_line1 ?? "",
        city: l.city ?? "",
        postal_code: l.postal_code,
        is_primary: l.is_primary,
      }))}
    />
  );
}
