import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { TransportMode } from "@/schema/route";
import type { Avatar } from "@/lib/avatar";

export type ModelKey = "bus" | "car" | "motorcycle" | "train" | "man" | "woman";
export type ClipName = "walk" | "idle" | "run" | "jump";

interface ModelSpec {
  url: string;
  /** Real-world size in metres along the model's long horizontal axis (or height for people). */
  size: number;
  measure: "length" | "height";
  /** Extra yaw (degrees) so the model faces +Y (north) at bearing 0. Tuned per asset. */
  yaw: number;
  clips?: Partial<Record<ClipName, string>>;
}

export const MODELS: Record<ModelKey, ModelSpec> = {
  bus: { url: "/models/bus.glb", size: 11, measure: "length", yaw: 180 },
  car: { url: "/models/car.glb", size: 4.2, measure: "length", yaw: 0 },
  motorcycle: { url: "/models/motorcycle.glb", size: 2.1, measure: "length", yaw: 0 },
  train: { url: "/models/train.glb", size: 22, measure: "length", yaw: 180 },
  man: {
    url: "/models/man.glb",
    size: 1.75,
    measure: "height",
    yaw: 180,
    clips: {
      walk: "HumanArmature|Man_Walk",
      idle: "HumanArmature|Man_Idle",
      run: "HumanArmature|Man_Run",
      jump: "HumanArmature|Man_Jump",
    },
  },
  woman: {
    url: "/models/woman.glb",
    size: 1.65,
    measure: "height",
    yaw: 180,
    clips: { walk: "Armature|Walking", idle: "Armature|Idle", run: "Armature|Running", jump: "Armature|Jump" },
  },
};

export const isPerson = (k: ModelKey) => MODELS[k].measure === "height";

/** Which asset represents each mode. Auto-rickshaw and ferry are procedural (see procedural.ts). */
export function modelForMode(mode: TransportMode, avatar: Avatar): ModelKey | "auto" | "boat" | null {
  switch (mode) {
    case "walking":
    case "cycling":
      return avatar;
    case "bike_taxi":
      return "motorcycle";
    case "taxi":
      return "car";
    case "auto_rickshaw":
      return "auto";
    case "bus":
      return "bus";
    case "metro":
    case "train":
      return "train";
    case "ferry":
      return "boat";
    default:
      return null;
  }
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<ModelKey, Promise<GLTF>>();

export function loadModel(key: ModelKey): Promise<GLTF> {
  let p = cache.get(key);
  if (!p) {
    p = loader.loadAsync(MODELS[key].url);
    // Allow retry after a failed load.
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export interface Instance {
  /** Root in local ENU metres: x east, y north, z up. Rotate around z for heading. */
  root: THREE.Group;
  mixer?: THREE.AnimationMixer;
  actions: Partial<Record<ClipName, THREE.AnimationAction>>;
  /** Cross-fades to a looping clip (no-op if the model has no such clip). */
  play(name: ClipName, fade?: number): void;
  /** Plays a clip once, then returns to `then`. */
  once(name: ClipName, then: ClipName): void;
  current?: ClipName;
}

/**
 * Normalised clone of a model: Y-up asset rotated to Z-up, standing on z=0, centred on
 * its footprint, scaled to real-world size, long axis pointing north (+Y).
 */
export function instantiate(key: ModelKey, gltf: GLTF): Instance {
  const spec = MODELS[key];
  const obj = (spec.clips ? cloneSkinned(gltf.scene) : gltf.scene.clone(true)) as THREE.Object3D;
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    // Skinned bounding volumes are computed in bind pose and are often wrong after
    // normalisation; these scenes are tiny, so skip culling instead of risking pop-out.
    if ((o as THREE.Mesh).isMesh) o.frustumCulled = false;
  });

  const box = new THREE.Box3().setFromObject(obj, true);
  const size = box.getSize(new THREE.Vector3());
  // Vehicles: align their longest horizontal axis. People: glTF convention, face +Z.
  const longIsX = spec.measure === "length" && size.x > size.z;
  const measured = spec.measure === "height" ? size.y : Math.max(size.x, size.z);
  const s = spec.size / (measured || 1);

  const centre = box.getCenter(new THREE.Vector3());
  obj.position.set(-centre.x, -box.min.y, -centre.z);

  const yUp = new THREE.Group(); // asset space (Y up)
  yUp.add(obj);
  yUp.scale.setScalar(s);
  // Point long axis along asset -Z, which maps to north after the X rotation below.
  yUp.rotation.y = (longIsX ? Math.PI / 2 : 0) + THREE.MathUtils.degToRad(spec.yaw);

  const zUp = new THREE.Group();
  zUp.rotation.x = Math.PI / 2;
  zUp.add(yUp);

  const root = new THREE.Group();
  root.add(zUp);

  const inst: Instance = { root, actions: {}, play: () => {}, once: () => {} };
  if (spec.clips) {
    const mixer = new THREE.AnimationMixer(obj);
    inst.mixer = mixer;
    for (const [name, clipName] of Object.entries(spec.clips) as [ClipName, string][]) {
      const clip = gltf.animations.find((a) => a.name === clipName);
      if (clip) inst.actions[name] = mixer.clipAction(clip);
    }
    inst.play = (name, fade = 0.25) => {
      const next = inst.actions[name];
      if (!next || inst.current === name) return;
      const prev = inst.current ? inst.actions[inst.current] : undefined;
      next.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      if (prev) prev.crossFadeTo(next, fade, false);
      inst.current = name;
    };
    inst.once = (name, then) => {
      const a = inst.actions[name];
      if (!a) return;
      const prev = inst.current ? inst.actions[inst.current] : undefined;
      a.reset().setLoop(THREE.LoopOnce, 1).play();
      a.clampWhenFinished = true;
      if (prev) prev.crossFadeTo(a, 0.15, false);
      inst.current = name;
      const done = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== a) return;
        mixer.removeEventListener("finished", done);
        inst.current = undefined;
        const back = inst.actions[then];
        if (back) {
          back.reset().setLoop(THREE.LoopRepeat, Infinity).play();
          a.crossFadeTo(back, 0.2, false);
          inst.current = then;
        }
      };
      mixer.addEventListener("finished", done);
    };
    inst.play("walk", 0);
  }
  return inst;
}
