import { ImageResponse } from "next/og";

export const alt = "Skootayiko — get around Kochi";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#10233a";
const TEAL = "#0d9488";
const MANGO = "#f5b301";
const CORAL = "#f97357";

function Wheel({ color, px }: { color: string; px: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="16" fill="none" stroke={color} strokeWidth="7" />
      <circle cx="20" cy="20" r="4.5" fill={color} />
      <path d="M20 8v6M20 26v6M8 20h6M26 20h6" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Link preview card (WhatsApp, Telegram, X, Slack …). Next.js wires it into og:image and twitter:image. */
export default function OpengraphImage() {
  const text = { fontSize: 168, fontWeight: 800, color: INK, letterSpacing: -4, lineHeight: 1 } as const;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#fbf5e8",
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 28, background: TEAL, display: "flex" }} />
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={text}>Sk</span>
          <div style={{ display: "flex", margin: "0 4px", marginTop: 14 }}>
            <Wheel color={TEAL} px={132} />
            <Wheel color={MANGO} px={132} />
          </div>
          <span style={text}>tayiko</span>
          <div style={{ width: 28, height: 28, borderRadius: 14, background: CORAL, marginLeft: 8, marginTop: 90, display: "flex" }} />
        </div>
        <div style={{ display: "flex", marginTop: 36, fontSize: 46, fontWeight: 600, color: INK, opacity: 0.8 }}>
          Find the smartest way across Kochi
        </div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 30, color: TEAL, fontWeight: 700 }}>
          Metro · Bus · Boat · Auto · Taxi — by time and cost
        </div>
      </div>
    ),
    size,
  );
}
