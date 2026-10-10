// MapLibre v6 loads its worker from a sibling file; bundlers cannot resolve that,
// so the worker is served from /public and registered with setWorkerUrl().
import fs from "node:fs";
fs.mkdirSync("public/vendor", { recursive: true });
fs.copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/vendor/maplibre-gl-worker.mjs");
