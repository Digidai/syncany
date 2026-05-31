"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/heroui-pro/menu";
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
              crowding the top nav. */}
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

  return (
    <DropdownMenu onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="!h-auto !rounded-none !bg-transparent !px-0 !py-0 text-zinc-400 hover:!bg-transparent hover:text-white"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        For <ChevronDown className="h-3 w-3 transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-56 rounded-xl border border-zinc-800 bg-zinc-950">
        <DropdownMenuItem href="/indie" className="!px-3 !py-2">
          <div>
            <div className="font-medium">Indie devs</div>
            <div className="mt-0.5 text-[11.5px] text-zinc-500">Solo dev / AI tinkerer</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem href="/teams" className="!px-3 !py-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span>Teams</span>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-amber-300">
                Waitlist
              </span>
            </div>
            <div className="mt-0.5 text-[11.5px] text-zinc-500">Mid-market eng orgs</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
