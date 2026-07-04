import BottomNav from "@/components/BottomNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/kuve-logo.jpg" alt="KUVE Finance" />
      </header>
      <div className="wrap">{children}</div>
      <BottomNav />
    </>
  );
}
