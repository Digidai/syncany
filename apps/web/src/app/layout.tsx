import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { snProFont } from "@/fonts/font";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ToastProvider } from "@/components/ui/toast";

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Syncany",
  description: "Human-AI collaboration platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "antialiased",
        snProFont.variable,
        geistMono.variable,
      )}
    >
      <body className="min-h-screen bg-background">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
