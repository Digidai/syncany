"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { RalticLogo } from "./raltic-logo";

/**
 * Marketing site sticky nav.
 *
 * Hero is now true BLACK (Spectrum-style). Text is light regardless of
 * scroll; only the background and border treatment change:
 *
 *   - top:      transparent (the hero shows through clean)
 *   - scrolled: dark glass with backdrop-blur + bottom hairline, since
 *               the marketing page alternates dark/light bands and a
 *               heavy glass surface gives the bar discrete presence
 *               regardless of which band is under it
 *
 * If we ever bring the cream-hero treatment back, this needs to flip:
 * dark-text-on-light glass instead of the current light-text-on-dark-
 * glass. Don't make that change blind — pick by what's under it.
 */
export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;
    let last = false;
    const compute = () => {
      ticking = false;
      const next = window.scrollY > 24;
      if (next !== last) {
        last = next;
        setScrolled(next);
      }
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-zinc-900/80 bg-black/70 backdrop-blur-xl supports-[backdrop-filter]:bg-black/55"
          : "bg-transparent",
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-medium tracking-tight text-white"
        >
          <RalticLogo size={32} idSuffix="nav" />
          <span>Raltic</span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-zinc-400 md:flex">
          <a href="#how" className="hover:text-white">How it works</a>
          <a href="#use-cases" className="hover:text-white">Use cases</a>
          <a href="#why" className="hover:text-white">Why Raltic</a>
          <Link href="/login" className="hover:text-white">Sign in</Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 font-medium text-black hover:bg-zinc-200"
          >
            Get started <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </nav>

        <Link
          href="/signup"
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black md:hidden"
        >
          Start
        </Link>
      </div>
    </header>
  );
}
