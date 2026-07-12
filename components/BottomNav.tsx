"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  {
    href: "/dashboard", label: "Cuenta",
    icon: <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />,
  },
  {
    href: "/history", label: "Historial",
    icon: <path d="M13 3a9 9 0 0 0-9 9H1l3.9 3.9L8.8 12H6a7 7 0 1 1 7 7v2a9 9 0 0 0 0-18zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12z" />,
  },
  {
    href: "/performance", label: "Rendimiento",
    icon: <path d="M3.5 18.5l6-6 4 4L22 7.92 20.59 6.5 13.5 13.5l-4-4L2 17l1.5 1.5z" />,
  },
  {
    href: "/profile", label: "Perfil",
    icon: <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z" />,
  },
];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav className="bottomnav">
      {items.map((it) => (
        <Link key={it.href} href={it.href} className={path.startsWith(it.href) ? "active" : ""}>
          <svg viewBox="0 0 24 24" fill="currentColor">{it.icon}</svg>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
