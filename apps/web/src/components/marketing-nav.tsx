"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/heroui-pro/button";
import { MarketingButton } from "@/components/marketing/marketing-button";
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

        <nav className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
          <Link href="/runtimes" className="hover:text-white">Runtimes</Link>
          <Link href="/connectors" className="hover:text-white">Connectors</Link>
          <Link href="/desktop" className="hover:text-white">Desktop beta</Link>
          <Link href="/security" className="hover:text-white">Security</Link>
          {/* Audience dropdown — surfaces /indie + /teams without
              crowding the top nav. CSS-only popover via group-hover so
              it works without JS state + closes when pointer leaves. */}
          <ForDropdown />
          <Link href="/login" className="hover:text-white">Sign in</Link>
          <MarketingButton href="/signup" variant="nav-primary">
            Get started <ArrowRight className="h-3.5 w-3.5" />
          </MarketingButton>
        </nav>

        <MarketingButton href="/signup" variant="nav-primary" className="md:!hidden">
          Start
        </MarketingButton>
      </div>
    </header>
  );
}

/**
 * "For" / Audiences dropdown. Click-only — earlier draft combined
 * pointerEnter (open) + click (toggle), which collided: the pointer
 * sweep landing on the trigger fired pointerEnter→open, and the
 * subsequent click toggled it shut again. Easy to misread as broken.
 * Now: click opens, click again or click-outside or Escape closes.
 */
function ForDropdown() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <Button
        type="button"
        onClick={() => setOpen(v => !v)}
        variant="ghost"
        size="sm"
        className="!h-auto !rounded-none !bg-transparent !px-0 !py-0 text-zinc-400 hover:!bg-transparent hover:text-white"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        For <ChevronDown className="h-3 w-3 transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.6)]"
        >
          <Link
            role="menuitem"
            href="/indie"
            className="block rounded-md px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-white"
            onClick={() => setOpen(false)}
          >
            <div className="font-medium">Indie devs</div>
            <div className="mt-0.5 text-[11.5px] text-zinc-500">Solo dev / AI tinkerer</div>
          </Link>
          <Link
            role="menuitem"
            href="/teams"
            className="block rounded-md px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 hover:text-white"
            onClick={() => setOpen(false)}
          >
            <div className="font-medium">
              Teams <span className="ml-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-300">Waitlist</span>
            </div>
            <div className="mt-0.5 text-[11.5px] text-zinc-500">Mid-market eng orgs</div>
          </Link>
        </div>
      )}
    </div>
  );
}
