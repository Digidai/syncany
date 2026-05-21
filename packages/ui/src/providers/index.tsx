"use client";

// React context + hook for the PlatformAdapter. UI components call
// `usePlatform()` to access host capabilities; the host wires its concrete
// adapter into <PlatformProvider value={…}>.

import { createContext, useContext, type ReactNode } from "react";
import type { PlatformAdapter } from "../lib/platform";

const PlatformContext = createContext<PlatformAdapter | null>(null);

export function PlatformProvider({
  value, children,
}: {
  value: PlatformAdapter;
  children: ReactNode;
}) {
  return (
    // eslint-disable-next-line react/jsx-no-constructed-context-values
    <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
  );
}

/** Read the current host's platform adapter. Throws if PlatformProvider
 *  isn't mounted — fail loud, since silent fallback would mean half the
 *  UI tries to use missing capabilities at runtime. */
export function usePlatform(): PlatformAdapter {
  const v = useContext(PlatformContext);
  if (!v) {
    throw new Error(
      "usePlatform() called outside <PlatformProvider>. Wrap the app root " +
      "with your host's adapter (WebPlatformAdapter or ElectronPlatformAdapter).",
    );
  }
  return v;
}
