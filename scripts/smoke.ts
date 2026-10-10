import { planRoutes } from "@/server/routing/plan";
const trips = [
  ["Edappally", 10.0255, 76.308, "MG Road", 9.97, 76.28],
  ["Kakkanad", 10.0159, 76.3419, "Vyttila", 9.9673, 76.3215],
  ["Fort Kochi", 9.9658, 76.2421, "Ernakulam South", 9.9686, 76.2896],
  ["Aluva", 10.1076, 76.3516, "Kalamassery", 10.053, 76.327],
  ["Kaloor", 9.9943, 76.2914, "Palarivattom", 10.0064, 76.3048],
] as const;
const times = process.argv.slice(2).filter((a) => a.includes("T"));
for (const at of times.length ? times : ["2026-10-12T09:00:00+05:30", "2026-10-12T22:30:00+05:30"]) {
  console.log(`\n##### depart ${at}`);
  for (const [on, olat, olon, dn, dlat, dlon] of trips) {
    const r = await planRoutes({ origin: { name: on, location: { lat: olat, lon: olon } }, destination: { name: dn, location: { lat: dlat, lon: dlon } }, departAt: at }, { useOrs: false });
    console.log(`== ${on} -> ${dn}: ` + r.options.map((o) => `[${o.rankings.join(",")}] ${o.label} ${Math.round(o.totalDurationSeconds / 60)}m ₹${o.totalCostEstimate?.min}-${o.totalCostEstimate?.max}`).join(" | "));
  }
}

// Day planner: Fort Kochi → Ernakulam South with 3 h and 5 h.
const { planDay } = await import("@/server/routing/dayplan");
const { ItineraryRequest } = await import("@/schema/itinerary");
for (const budgetMin of [180, 300]) {
  const d = await planDay(
    ItineraryRequest.parse({
      start: { name: "Fort Kochi Jetty", location: { lat: 9.9667, lon: 76.2434 } },
      end: { name: "Ernakulam South", location: { lat: 9.9686, lon: 76.2896 } },
      startAt: "2026-10-12T09:00:00+05:30",
      budgetMin,
      interests: ["sights", "heritage", "museums", "beaches"],
      lunch: true,
    }),
    { useOrs: false, suggest: null },
  );
  console.log(`\n== day ${budgetMin / 60}h: ${d.usedMin}/${d.budgetMin} min fits=${d.fits} score=${d.totalScore} :: ${d.stops.map((s) => s.name).join(" > ")}`);
  console.log(`   left out: ${d.dropped.map((x) => `${x.sight.name} (${x.reason})`).join(", ")}`);
}
