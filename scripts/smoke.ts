import { planRoutes } from "@/server/routing/plan";
const trips = [
  ["Aluva", 10.1076, 76.3516, "Vyttila Hub", 9.9673, 76.3215],
  ["Kalamassery", 10.0530, 76.3270, "Infopark", 10.0152, 76.3636],
  ["Fort Kochi", 9.9658, 76.2421, "Vypin", 9.9760, 76.2420],
  ["MG Road", 9.9700, 76.2800, "Kakkanad", 10.0159, 76.3419],
] as const;
const useOrs = process.argv.includes("--ors");
for (const [on, olat, olon, dn, dlat, dlon] of trips) {
  const t0 = Date.now();
  const r = await planRoutes({ origin: { name: on, location: { lat: olat, lon: olon } }, destination: { name: dn, location: { lat: dlat, lon: dlon } }, departAt: "2026-10-12T08:30:00+05:30" }, { useOrs });
  console.log(`\n== ${on} -> ${dn} (${Date.now() - t0} ms) warnings=${r.dataWarnings?.length}`);
  for (const o of r.options) {
    console.log(`  [${o.rankings.join(",")}] ${o.label}: ${Math.round(o.totalDurationSeconds / 60)} min, ₹${o.totalCostEstimate?.min}-${o.totalCostEstimate?.max}, transfers=${o.transfers}`);
    for (const s of o.segments) console.log(`     ${s.mode} ${s.origin.name} -> ${s.destination.name} ${Math.round(s.durationSeconds/60)}m +wait ${Math.round(s.waitSeconds/60)}m ${s.distanceMeters}m geom=${s.geometry.length} ₹${s.costEstimate?.min}-${s.costEstimate?.max} ${s.dataSource}`);
  }
}
