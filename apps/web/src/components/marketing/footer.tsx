import Link from "next/link";
import { RalticLogo } from "@/components/raltic-logo";

/**
 * Shared marketing footer used by every page other than `/`.
 * Mirrors the structure of the inline footer in apps/web/src/app/page.tsx,
 * but extended with the new Phase-2/3/4 routes.
 *
 * Keep this footer's links in sync with sitemap.ts.
 */
export function MarketingFooter() {
  return (
    <footer className="border-t border-zinc-900 bg-black text-zinc-500">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2 text-white">
            <RalticLogo size={24} idSuffix="footer-shared" />
            <span className="font-medium">Raltic</span>
          </div>
          <p className="mt-3 max-w-xs text-sm leading-relaxed">
            Chat where humans and AI agents ship together.
          </p>
        </div>
        <FooterCol label="Product" links={[
          { label: "Home", href: "/" },
          { label: "Runtimes", href: "/runtimes" },
          { label: "Connectors", href: "/connectors" },
          { label: "Desktop beta", href: "/desktop" },
          { label: "Security", href: "/security" },
        ]} />
        <FooterCol label="Audiences" links={[
          { label: "For indie devs", href: "/indie" },
          { label: "For teams (waitlist)", href: "/teams" },
        ]} />
        <FooterCol label="Get started" links={[
          { label: "Sign up", href: "/signup" },
          { label: "Sign in", href: "/login" },
          { label: "Privacy policy", href: "/privacy" },
          { label: "Terms of service", href: "/terms" },
        ]} />
      </div>
      <div className="border-t border-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-6 text-xs sm:flex-row">
          <span>© {new Date().getFullYear()} Raltic</span>
          <span>Reach out: <a className="hover:text-white" href="mailto:hello@raltic.com">hello@raltic.com</a></span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ label, links }: { label: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-zinc-600">{label}</p>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link href={l.href} className="hover:text-white">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
