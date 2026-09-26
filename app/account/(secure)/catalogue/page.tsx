import { CustomerCatalogue } from "@/components/customer/CustomerCatalogue";
import { getTyreDimensions } from "@/lib/server/catalogue-dimensions";

export const dynamic = "force-dynamic";

/**
 * The size lists are resolved ON THE SERVER and rendered with the page.
 *
 * "It takes quite a lot to load values in dropdowns" — because they were
 * fetched by the browser after mount, from a query that scanned the catalogue.
 * Reading them here means the three selectors arrive already populated in the
 * first HTML the customer receives: no spinner, no empty dropdown, no request.
 *
 * They are cached and unfiltered, so this costs nothing per request and the
 * lists are identical no matter what is selected.
 */
export default async function CustomerCataloguePage() {
  const dimensions = await getTyreDimensions();
  return (
    <CustomerCatalogue
      widths={[...dimensions.widths]}
      aspectRatios={[...dimensions.aspectRatios]}
      rims={[...dimensions.rims]}
    />
  );
}
