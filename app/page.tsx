import { GlobalHeader } from "@/components/site/GlobalHeader";
import { Hero } from "@/components/site/Hero";
import { CoverageArea } from "@/components/site/CoverageArea";
import { WhyGommaRush } from "@/components/site/WhyGommaRush";

/**
 * Public landing page.
 *
 * Navigation is entirely inside the hamburger menu (GlobalHeader) at every
 * breakpoint — there is no horizontal desktop nav bar by design. Every
 * destination that used to sit in the old header (driver area, admin) is
 * preserved inside the menu, alongside the language switch.
 */
export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <GlobalHeader />
      <main className="flex flex-1 flex-col">
        <Hero />
        <CoverageArea />
        <WhyGommaRush />
      </main>
    </div>
  );
}
