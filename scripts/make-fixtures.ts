import fs from "node:fs";
import path from "node:path";
import { RoutePlanResponse } from "@/schema/route";
import { planRoutes } from "@/server/routing/plan";

// Sample journeys used as UI fixtures (Monday 08:30 IST). Run with ORS key set for real road geometry.
const JOURNEYS = [
  { file: "aluva-vyttila", o: ["Aluva", 10.1076, 76.3516], d: ["Vyttila Hub", 9.9673, 76.3215] },
  { file: "mgroad-kakkanad", o: ["MG Road", 9.97, 76.28], d: ["Kakkanad", 10.0159, 76.3419] },
  { file: "kalamassery-infopark", o: ["Kalamassery", 10.053, 76.327], d: ["Infopark", 10.0152, 76.3636] },
] as const;

const useOrs = !process.argv.includes("--no-ors");
for (const j of JOURNEYS) {
  const plan = await planRoutes(
    {
      origin: { name: j.o[0], location: { lat: j.o[1], lon: j.o[2] } },
      destination: { name: j.d[0], location: { lat: j.d[1], lon: j.d[2] } },
      departAt: "2026-10-12T08:30:00+05:30",
    },
    { useOrs },
  );
  const out = RoutePlanResponse.parse({ ...plan, mock: true, generatedAt: "2026-10-10T00:00:00.000Z" });
  const p = path.resolve("src/fixtures", `${j.file}.json`);
  fs.writeFileSync(p, JSON.stringify(out, null, 1));
  console.log(`${p}: ${out.options.length} options`);
  // Stay under the ORS per-minute guard between journeys.
  if (useOrs) await new Promise((r) => setTimeout(r, 20_000));
}
