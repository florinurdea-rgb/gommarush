import { redirect } from "next/navigation";

/**
 * The M7 search screen, superseded by the M11B Catalogue workspace.
 *
 * Kept as a redirect rather than deleted: the route was linked from the admin
 * nav and may be bookmarked, and two competing catalogue experiences is
 * exactly what M11B set out to remove. Everything this page did — size and
 * season filters, the priced breakdown — the workspace does, across every
 * supplier rather than one.
 */
export default function CatalogueSearchRedirect() {
  redirect("/admin/catalogue");
}
