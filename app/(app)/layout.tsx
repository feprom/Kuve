import BottomNav from "@/components/BottomNav";
import Logo from "@/components/Logo";
import ReclamaReferido from "@/components/ReclamaReferido";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Logo height={66} />
          <span className="tag" style={{ marginLeft: "auto" }}>KV-9014</span>
        </div>
      </header>
      <ReclamaReferido />
      <div className="wrap">{children}</div>
      <BottomNav />
    </>
  );
}
