import Link from "next/link";

export const metadata = { title: "About & attribution — Skootayiko" };

export default function About() {
  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6 text-sm leading-relaxed">
      <Link href="/" className="text-teal-700 underline">
        ← Back to planner
      </Link>
      <h1 className="text-xl font-bold">About this planner</h1>
      <p>
        Skootayiko compares multimodal journeys across Kochi. All times and fares are <strong>estimates</strong>. The 3D view is a{" "}
        <strong>journey preview</strong> that moves a model along the planned route; it is not live vehicle tracking.
      </p>
      <h2 className="text-base font-semibold">Data</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Kochi Metro timetable and fares: KMRL GTFS feed (valid until 2025-12-31; used as a typical timetable).</li>
        <li>
          Bus and boat routes: Jungle Bus Kochi GTFS, derived from OpenStreetMap (2022–23). Headways in this feed are placeholders, so
          waits use an assumed 20-minute bus headway. No fares are published; bus, boat, auto, bike-taxi and taxi fares are approximate
          ranges from <code>config/fares.json</code>.
        </li>
        <li>Road and walking directions: openrouteservice by HeiGIT, © OpenStreetMap contributors.</li>
        <li>Place search: LocationIQ, © OpenStreetMap contributors.</li>
        <li>Map tiles: © MapTiler © OpenStreetMap contributors.</li>
      </ul>
      <h2 className="text-base font-semibold">3D models</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Animated Woman, Man, High Speed Train Front — Quaternius (CC0), via Poly Pizza.</li>
        <li>Bus, Motorcycle — Poly by Google (CC BY 3.0), via Poly Pizza.</li>
        <li>Red Car — J-Toastie, via Poly Pizza (check licence on the source page).</li>
        <li>Auto-rickshaw, boat, viaduct, stations and stop signs are simple procedural shapes.</li>
      </ul>
    </main>
  );
}
