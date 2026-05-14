export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Chat shell is fixed-viewport, no-scroll — internal regions
  // (sidebar, message list, etc.) own their own scroll.
  return <div className="flex h-screen overflow-hidden">{children}</div>;
}
