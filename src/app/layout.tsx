import type { Metadata, Viewport } from "next";
import { Baloo_Chettan_2 } from "next/font/google";
import "./globals.css";

const display = Baloo_Chettan_2({
  subsets: ["latin", "malayalam"],
  weight: ["500", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Skootayiko — get around Kochi",
  description: "Compare metro, bus, boat, auto and taxi routes across Kochi by time and cost, then ride the journey in 3D.",
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
