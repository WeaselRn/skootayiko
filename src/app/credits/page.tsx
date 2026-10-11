import Link from "next/link";

export const metadata = { title: "Credits — Skootayiko" };

interface Model {
  /** Name as shown on Poly Pizza, followed by the creator. */
  title: string;
  creator: string;
  /** Poly Pizza model id (the suffix of the original download file name). */
  id: string;
  license: string;
  licenseUrl?: string;
  usedAs: string;
}

const CC0 = { license: "CC0 1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" };
const CC_BY = { license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/" };

const MODELS: Model[] = [
  { title: "Animated Woman", creator: "Quaternius", id: "9kF7eTDbhO", ...CC0, usedAs: "Walking avatar (woman)" },
  { title: "Man", creator: "Quaternius", id: "HMnuH5geEG", ...CC0, usedAs: "Walking avatar (man)" },
  { title: "High Speed Front", creator: "Quaternius", id: "mJZDSqyzlk", ...CC0, usedAs: "Metro train" },
  { title: "Bus", creator: "Poly by Google", id: "4CPpvEmrMoF", ...CC_BY, usedAs: "Bus" },
  { title: "Motorcycle", creator: "Poly by Google", id: "dse64pqMKAR", ...CC_BY, usedAs: "Bike taxi" },
  { title: "Red Car", creator: "J-Toastie", id: "dVLJ5CjB0h", license: "See source page", usedAs: "Taxi" },
];

interface Project {
  name: string;
  url: string;
  license: string;
  what: string;
}

const PROJECTS: Project[] = [
  { name: "Next.js", url: "https://nextjs.org", license: "MIT", what: "App framework" },
  { name: "React", url: "https://react.dev", license: "MIT", what: "UI library" },
  { name: "three.js", url: "https://threejs.org", license: "MIT", what: "3D rendering of the ride preview" },
  { name: "MapLibre GL JS", url: "https://maplibre.org", license: "BSD-3-Clause", what: "Interactive map" },
  { name: "Zod", url: "https://zod.dev", license: "MIT", what: "Request and response validation" },
  { name: "Tailwind CSS", url: "https://tailwindcss.com", license: "MIT", what: "Styling" },
  { name: "TypeScript", url: "https://www.typescriptlang.org", license: "Apache-2.0", what: "Language" },
  { name: "Vitest", url: "https://vitest.dev", license: "MIT", what: "Testing" },
  { name: "tsx", url: "https://tsx.is", license: "MIT", what: "Running build scripts" },
  { name: "csv-parse", url: "https://csv.js.org/parse/", license: "MIT", what: "Reading GTFS feeds" },
  { name: "glTF-Transform", url: "https://gltf-transform.dev", license: "MIT", what: "Optimising 3D models" },
  { name: "obj2gltf", url: "https://github.com/CesiumGS/obj2gltf", license: "Apache-2.0", what: "Converting the Bus model" },
  { name: "OpenNext for Cloudflare", url: "https://opennext.js.org/cloudflare", license: "MIT", what: "Deployment adapter" },
  { name: "Baloo Chettan 2", url: "https://fonts.google.com/specimen/Baloo+Chettan+2", license: "SIL OFL 1.1", what: "Logo and headline font" },
];

const DATA: { name: string; url: string; note: string }[] = [
  { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright", note: "Map data, ODbL, © OpenStreetMap contributors" },
  { name: "openrouteservice (HeiGIT)", url: "https://openrouteservice.org", note: "Road and walking directions" },
  { name: "OSRM", url: "https://project-osrm.org", note: "Fallback street paths, via routing.openstreetmap.de (FOSSGIS e.V.)" },
  { name: "LocationIQ", url: "https://locationiq.com", note: "Place search and nearby sights" },
  { name: "MapTiler", url: "https://www.maptiler.com/copyright/", note: "Map tiles, © MapTiler" },
  { name: "Kochi Metro Rail Ltd (KMRL)", url: "https://kochimetro.org", note: "Metro GTFS timetable and fares" },
  { name: "Jungle Bus", url: "https://junglebus.io", note: "Kochi bus and boat GTFS, derived from OpenStreetMap" },
];

const link = "text-teal-700 underline";

export default function Credits() {
  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6 text-sm leading-relaxed">
      <Link href="/" className={link}>
        ← Back to planner
      </Link>
      <h1 className="text-xl font-bold">Credits</h1>
      <p>
        Skootayiko stands on the work of many creators and open-source projects. Thank you to everyone below. See also{" "}
        <Link href="/about" className={link}>
          About &amp; data sources
        </Link>
        .
      </p>

      <h2 className="text-base font-semibold">3D models</h2>
      <p>Downloaded from Poly Pizza. Each entry gives the model name and its creator, as listed there.</p>
      <ul className="space-y-2">
        {MODELS.map((m) => (
          <li key={m.id} className="rounded-lg border border-black/10 p-3">
            <div className="font-semibold">
              <a className={link} href={`https://poly.pizza/m/${m.id}`} target="_blank" rel="noreferrer">
                {m.title}
              </a>{" "}
              by {m.creator}
            </div>
            <div className="text-[var(--color-muted)]">
              Used as: {m.usedAs} ·{" "}
              {m.licenseUrl ? (
                <a className={link} href={m.licenseUrl} target="_blank" rel="noreferrer">
                  {m.license}
                </a>
              ) : (
                m.license
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[var(--color-muted)]">
        Models were resized and converted to glTF for the web. The auto-rickshaw, ferry, metro viaduct, stations and stop signs are
        procedural shapes made for this project.
      </p>

      <h2 className="text-base font-semibold">Open-source projects</h2>
      <ul className="list-disc space-y-1 pl-5">
        {PROJECTS.map((p) => (
          <li key={p.name}>
            <a className={link} href={p.url} target="_blank" rel="noreferrer">
              {p.name}
            </a>{" "}
            ({p.license}) — {p.what}
          </li>
        ))}
      </ul>

      <h2 className="text-base font-semibold">Data and services</h2>
      <ul className="list-disc space-y-1 pl-5">
        {DATA.map((d) => (
          <li key={d.name}>
            <a className={link} href={d.url} target="_blank" rel="noreferrer">
              {d.name}
            </a>{" "}
            — {d.note}
          </li>
        ))}
      </ul>
    </main>
  );
}
