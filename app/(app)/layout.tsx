import BottomNav from "@/components/BottomNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="wrap">{children}</div>
      <BottomNav />
    </>
  );
}
