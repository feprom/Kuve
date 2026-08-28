import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://kuve-wine.vercel.app"),
  title: "KUVE Finance",
  description: "Portal de clientes de KUVE Finance: tu cartera, tus resultados y tus informes.",
  applicationName: "KUVE Finance",
  appleWebApp: {
    capable: true,
    title: "KUVE",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    type: "website",
    siteName: "KUVE Finance",
    title: "KUVE Finance",
    description: "Portal de clientes de KUVE Finance: tu cartera, tus resultados y tus informes.",
    locale: "es_ES",
    images: [
      {
        url: "/kuve-logo.jpg",
        width: 1008,
        height: 501,
        alt: "KUVE Finance",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "KUVE Finance",
    description: "Portal de clientes de KUVE Finance: tu cartera, tus resultados y tus informes.",
    images: ["/kuve-logo.jpg"],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
