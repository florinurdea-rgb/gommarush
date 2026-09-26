import { vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "@/components/site/LocaleProvider";

/** Shared router mock for component tests. Import this module before the component under test. */
export const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

export function renderIt(ui: ReactElement) {
  return render(<LocaleProvider initialLocale="it">{ui}</LocaleProvider>);
}
