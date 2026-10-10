/**
 * Converts and optimises the source 3D assets in "3d assets/" into public/models/*.glb.
 *  - Bus: OBJ+MTL+PNG (zip) -> GLB via obj2gltf.
 *  - All: drop unused animation clips, dedup/prune/weld, WebP textures (<=512 px), meshopt compression.
 * Run: npm run models:build
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import obj2gltf from "obj2gltf";
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, resample, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const SRC = path.resolve("3d assets");
const OUT = path.resolve("public/models");
const TMP = path.resolve(".cache/models");

const MODELS: { out: string; src: string; keepClips?: string[] }[] = [
  { out: "woman", src: "Animated Woman by Quaternius - 9kF7eTDbhO.glb", keepClips: ["Armature|Walking", "Armature|Idle", "Armature|Running", "Armature|Jump"] },
  { out: "man", src: "Man by Quaternius - HMnuH5geEG.glb", keepClips: ["HumanArmature|Man_Walk", "HumanArmature|Man_Idle", "HumanArmature|Man_Run", "HumanArmature|Man_Jump"] },
  { out: "train", src: "High Speed Front by Quaternius - mJZDSqyzlk.glb" },
  { out: "motorcycle", src: "Motorcycle by Poly by Google - dse64pqMKAR.glb" },
  { out: "car", src: "Red Car by J-Toastie - dVLJ5CjB0h.glb" },
  { out: "bus", src: "bus.glb" },
];

async function convertBus(): Promise<string> {
  const dir = path.join(TMP, "bus");
  fs.mkdirSync(dir, { recursive: true });
  const zip = fs.readdirSync(SRC).find((f) => f.startsWith("Bus") && f.endsWith(".zip"));
  if (!zip) throw new Error("Bus zip not found in 3d assets/");
  // Windows tar (bsdtar) and most Unix tars can read zip archives.
  if (!fs.readdirSync(dir).some((f) => f.endsWith(".obj"))) {
    try {
      execFileSync("tar", ["-xf", path.join(SRC, zip), "-C", dir]);
    } catch {
      execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -Path '${path.join(SRC, zip)}' -DestinationPath '${dir}'`]);
    }
  }
  const obj = fs.readdirSync(dir).find((f) => f.endsWith(".obj"))!;
  const glb: Buffer = await obj2gltf(path.join(dir, obj), { binary: true });
  const out = path.join(TMP, "bus.glb");
  fs.writeFileSync(out, glb);
  return out;
}

function keepClips(doc: Document, names?: string[]) {
  if (!names) return;
  for (const a of doc.getRoot().listAnimations()) if (!names.includes(a.getName())) a.dispose();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const busPath = await convertBus();

  for (const m of MODELS) {
    const src = m.out === "bus" ? busPath : path.join(SRC, m.src);
    const doc = await io.read(src);
    keepClips(doc, m.keepClips);
    await doc.transform(
      dedup(),
      prune(),
      weld(),
      resample(),
      textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512] }),
      meshopt({ encoder: MeshoptEncoder, level: "medium" }),
    );
    const out = path.join(OUT, `${m.out}.glb`);
    await io.write(out, doc);
    const before = fs.statSync(src).size;
    const after = fs.statSync(out).size;
    console.log(`${m.out.padEnd(11)} ${(before / 1024).toFixed(0).padStart(5)} KB -> ${(after / 1024).toFixed(0).padStart(5)} KB`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
