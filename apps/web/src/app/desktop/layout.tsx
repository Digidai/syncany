import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Raltic Desktop",
  robots: { index: false, follow: false },
};

export default function DesktopLayout({ children }: { children: React.ReactNode }) {
  return children;
}
