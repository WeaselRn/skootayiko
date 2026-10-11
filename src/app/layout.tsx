import type { Metadata, Viewport } from "next";
import { Baloo_Chettan_2 } from "next/font/google";
import "./globals.css";

const display = Baloo_Chettan_2({
  subsets: ["latin", "malayalam"],
  weight: ["500", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

/** Absolute base so og:image is a full URL (chat apps ignore relative ones). Set NEXT_PUBLIC_SITE_URL in production. */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

const TITLE = "Skootayiko — get around Kochi";
const DESCRIPTION = "Compare metro, bus, boat, auto and taxi routes across Kochi by time and cost, then ride the journey in 3D.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: "Skootayiko", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d9488",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
