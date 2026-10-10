import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Procedural props. All in local metres, Z up, facing +Y (north). */

const mat = (color: number | string, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04, ...opts });

function box(w: number, l: number, h: number, m: THREE.Material, z = 0, y = 0, x = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, l, h), m);
  mesh.position.set(x, y, z + h / 2);
  return mesh;
}

function wheel(x: number, y: number, r: number, m: THREE.Material, width = 0.18): THREE.Mesh {
  const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 16), m);
  w.rotation.z = Math.PI / 2;
  w.position.set(x, y, r);
  return w;
}

const TYRE = mat(0x1f2937, { roughness: 0.9 });
const GLASS = mat(0xbfe6f5, { transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.2 });
const LAMP = mat(0xfff7d1, { emissive: 0xfff1b0, emissiveIntensity: 1.2 });

/** Kerala auto-rickshaw: mango-yellow body, black canvas hood, windscreen and headlamp, ~2.7 m. */
export function autoRickshaw(): THREE.Group {
  const g = new THREE.Group();
  const yellow = mat(0xf5b301, { roughness: 0.45 });
  const black = mat(0x16181d, { roughness: 0.85 });
  const green = mat(0x0f766e, { roughness: 0.5 });
  // Lower tub and front cowl.
  g.add(box(1.32, 1.7, 0.75, yellow, 0.32, -0.35));
  const cowl = box(0.7, 0.9, 0.95, yellow, 0.32, 0.95);
  g.add(cowl);
  g.add(box(1.36, 1.76, 0.1, green, 0.62, -0.35)); // trim stripe
  // Canvas hood: half cylinder over the cabin.
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 1.75, 20, 1, false, 0, Math.PI), black);
  hood.rotation.x = Math.PI / 2;
  hood.rotation.y = Math.PI / 2;
  hood.position.set(0, -0.35, 1.45);
  g.add(hood);
  g.add(box(1.34, 1.75, 0.38, black, 1.07, -0.35)); // side curtains band
  const screen = box(1.15, 0.05, 0.62, GLASS, 1.12, 0.52);
  screen.rotation.x = -0.18;
  g.add(screen);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), LAMP);
  lamp.position.set(0, 1.42, 0.95);
  g.add(lamp);
  g.add(box(0.5, 0.15, 0.05, black, 1.25, 0.95)); // handlebar
  g.add(wheel(0, 1.12, 0.27, TYRE), wheel(0.62, -0.85, 0.27, TYRE), wheel(-0.62, -0.85, 0.27, TYRE));
  return g;
}

/** Kochi public ferry: white hull, sky-blue cabin, red trim, lifebuoys and a flag, ~14 m. */
export function boat(): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-2.4, -7);
  shape.lineTo(2.4, -7);
  shape.lineTo(2.4, 4);
  shape.quadraticCurveTo(2.2, 6.5, 0, 7.5);
  shape.quadraticCurveTo(-2.2, 6.5, -2.4, 4);
  shape.closePath();
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: false }), mat(0xf8fafc));
  g.add(hull);
  const stripe = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: false }), mat(0xdc2626));
  stripe.position.z = 1.4;
  g.add(stripe);
  g.add(box(3.8, 7.2, 2.0, mat(0x7dd3fc, { roughness: 0.3 }), 1.68, -1));
  for (const x of [-1.91, 1.91]) for (const y of [-3.6, -2, -0.4, 1.2]) g.add(box(0.04, 1.1, 0.8, GLASS, 2.3, y, x));
  g.add(box(4.1, 7.8, 0.18, mat(0x0369a1), 3.68, -1));
  for (const y of [-3.2, 1.4]) {
    const buoy = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.11, 8, 16), mat(0xf97316));
    buoy.rotation.y = Math.PI / 2;
    buoy.position.set(1.95, y, 2.9);
    g.add(buoy);
  }
  g.add(box(0.06, 0.06, 2.2, mat(0x334155), 3.85, -4.2));
  g.add(box(0.04, 0.9, 0.55, mat(0xf5b301, { side: THREE.DoubleSide }), 5.4, -3.75));
  return g;
}

/** Bus stop shelter with a blue sign and bench. */
export function busStop(): THREE.Group {
  const g = new THREE.Group();
  const post = mat(0x334155);
  g.add(box(0.1, 0.1, 2.6, post, 0, -1.3), box(0.1, 0.1, 2.6, post, 0, 1.3));
  g.add(box(1.4, 3.2, 0.12, mat(0x2563eb), 2.6));
  g.add(box(0.5, 2.2, 0.1, mat(0xf5b301), 0.5));
  g.add(box(0.9, 0.08, 0.6, mat(0x2563eb), 3.1, 1.6));
  return g;
}

/** Elevated KMRL station: platform, teal canopy (translucent so the rider stays visible), columns. */
export function metroStation(height: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(14, 70, 0.8, mat(0xf1f5f9), height - 0.8));
  g.add(box(14.6, 72, 0.3, mat(0x14b8a6, { transparent: true, opacity: 0.4, depthWrite: false }), height + 4.5));
  g.add(box(0.3, 70, 1.1, mat(0xf5b301), height, 0, 6.9), box(0.3, 70, 1.1, mat(0xf5b301), height, 0, -6.9));
  for (const y of [-30, -10, 10, 30]) {
    const c = box(1.4, 1.4, height - 0.8, mat(0xe2e8f0));
    c.position.y = y;
    g.add(c);
  }
  return g;
}

export const VIADUCT_HEIGHT = 12;

/** Instanced viaduct (deck + pillars + teal edge stripe) along a polyline in local metres. */
export function viaduct(points: THREE.Vector2[]): THREE.Group {
  const g = new THREE.Group();
  if (points.length < 2) return g;
  const decks: THREE.Matrix4[] = [];
  const stripes: THREE.Matrix4[] = [];
  const pillars: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 0, 1);
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = a.distanceTo(b);
    if (len < 0.01) continue;
    const ang = Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2;
    const q = new THREE.Quaternion().setFromAxisAngle(up, ang);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    decks.push(new THREE.Matrix4().compose(new THREE.Vector3(mid.x, mid.y, VIADUCT_HEIGHT - 0.6), q, new THREE.Vector3(8, len + 0.5, 1.2)));
    stripes.push(new THREE.Matrix4().compose(new THREE.Vector3(mid.x, mid.y, VIADUCT_HEIGHT - 0.95), q, new THREE.Vector3(8.15, len + 0.5, 0.35)));
    for (let d = 30 - carry; d < len; d += 30) {
      const p = a.clone().lerp(b, d / len);
      pillars.push(
        new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, (VIADUCT_HEIGHT - 1.2) / 2), q, new THREE.Vector3(1.8, 1.8, VIADUCT_HEIGHT - 1.2)),
      );
    }
    carry = (carry + len) % 30;
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const inst = (list: THREE.Matrix4[], m: THREE.Material) => {
    const im = new THREE.InstancedMesh(unit, m, Math.max(1, list.length));
    list.forEach((mx, i) => im.setMatrixAt(i, mx));
    im.count = list.length;
    return im;
  };
  g.add(inst(decks, mat(0xe7e5e4)), inst(stripes, mat(0x14b8a6)), inst(pillars, mat(0xd6d3d1)));
  return g;
}

/** Placeholder shown while a model loads or if it fails. */
export function proxy(length: number, color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(box(Math.max(0.6, length * 0.35), length, Math.max(1, length * 0.25), mat(new THREE.Color(color).getHex())));
  return g;
}

/* ---------- Grounding and target highlighting ---------- */

let shadowTex: THREE.Texture | null = null;
function softDiscTexture(): THREE.Texture {
  if (shadowTex) return shadowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, "rgba(15,23,42,0.55)");
  grd.addColorStop(0.55, "rgba(15,23,42,0.22)");
  grd.addColorStop(1, "rgba(15,23,42,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

/** Soft blob shadow that grounds a model (w × l metres). */
export function contactShadow(w: number, l: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, l),
    new THREE.MeshBasicMaterial({ map: softDiscTexture(), transparent: true, depthWrite: false }),
  );
  m.position.z = 0.03;
  m.renderOrder = -1;
  return m;
}

export interface TargetMarker {
  group: THREE.Group;
  update(t: number): void;
}

/** Pulsing ground ring plus a bobbing pin above the traveller, in the leg's colour. */
export function targetMarker(color: string, radius: number, height: number): TargetMarker {
  const group = new THREE.Group();
  const col = new THREE.Color(color);
  const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.86, radius, 48), ringMat);
  ring.position.z = 0.06;
  const pulseMat = ringMat.clone();
  const pulse = new THREE.Mesh(new THREE.RingGeometry(radius * 0.92, radius, 48), pulseMat);
  pulse.position.z = 0.05;
  const pinMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.45, roughness: 0.35 });
  const pin = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.22, radius * 0.5, 20), pinMat);
  cone.rotation.x = -Math.PI / 2; // tip pointing down (−Z)
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.2, 20, 12), pinMat);
  ball.position.z = radius * 0.3;
  pin.add(cone, ball);
  group.add(ring, pulse, pin);
  return {
    group,
    update(t) {
      const k = (t * 0.9) % 1;
      pulse.scale.setScalar(1 + k * 0.9);
      pulseMat.opacity = 0.7 * (1 - k);
      pin.position.z = height + radius * 0.55 + Math.sin(t * 3) * radius * 0.08;
      pin.rotation.z = t * 1.2;
    },
  };
}

/* ---------- Coconut palms ---------- */

let palmGeo: THREE.BufferGeometry | null = null;

/** One low-poly coconut palm (trunk + 8 drooping fronds + coconuts), vertex-coloured, ~8 m tall. */
function palmGeometry(): THREE.BufferGeometry {
  if (palmGeo) return palmGeo;
  const parts: THREE.BufferGeometry[] = [];
  const paint = (geo: THREE.BufferGeometry, hex: number) => {
    const c = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return geo.toNonIndexed();
  };
  // Slightly curved trunk from three tilted segments.
  let x = 0;
  let z = 0;
  for (let s = 0; s < 3; s++) {
    const h = 2.7;
    const seg = new THREE.CylinderGeometry(0.17 - s * 0.03, 0.22 - s * 0.03, h, 7);
    seg.rotateX(Math.PI / 2);
    seg.rotateY(0.07 * (s + 1));
    seg.translate(x + 0.1 * s, 0, z + h / 2);
    x += 0.18 * (s + 1) * 0.5;
    z += h * 0.99;
    parts.push(paint(seg, s % 2 ? 0x8b5a2b : 0x9c6b3c));
  }
  const top = new THREE.Vector3(x, 0, z);
  for (let f = 0; f < 8; f++) {
    const frond = new THREE.ConeGeometry(0.38, 3.6, 4, 1);
    frond.scale(1, 1, 0.18);
    frond.translate(0, 1.8, 0); // base at origin, extend along +Y
    frond.rotateX(-0.75 - (f % 2) * 0.25); // droop
    frond.rotateZ((f / 8) * Math.PI * 2);
    frond.translate(top.x, top.y, top.z);
    parts.push(paint(frond, f % 2 ? 0x2f9e44 : 0x40c057));
  }
  for (let k = 0; k < 3; k++) {
    const nut = new THREE.SphereGeometry(0.17, 6, 5);
    const a = (k / 3) * Math.PI * 2;
    nut.translate(top.x + Math.cos(a) * 0.25, Math.sin(a) * 0.25, top.z - 0.3);
    parts.push(paint(nut, 0x6b8e23));
  }
  palmGeo = mergeGeometries(parts)!;
  return palmGeo;
}

/** Cheap deterministic pseudo-random in [0,1). */
function rand(seed: number) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Instanced coconut palms lining a polyline (local metres), alternating sides. */
export function palmsAlong(points: THREE.Vector2[], spacing: number, offset: number, max: number, seed = 1): THREE.InstancedMesh | null {
  const mats: THREE.Matrix4[] = [];
  let carry = 0;
  let side = 1;
  let slot = 0;
  for (let i = 1; i < points.length && mats.length < max; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = a.distanceTo(b);
    if (len < 0.01) continue;
    const dir = b.clone().sub(a).normalize();
    const normal = new THREE.Vector2(-dir.y, dir.x);
    for (let d = spacing - carry; d < len && mats.length < max; d += spacing) {
      const r = rand(seed * 101 + slot++ * 7.13);
      if (r < 0.18) continue; // gaps keep it natural
      side = -side;
      const p = a.clone().lerp(b, d / len).add(normal.clone().multiplyScalar(side * (offset + r * 4)));
      const s = 0.75 + r * 0.55;
      mats.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(p.x, p.y, 0),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), r * Math.PI * 2),
          new THREE.Vector3(s, s, s),
        ),
      );
    }
    carry = (carry + len) % spacing;
  }
  if (!mats.length) return null;
  const im = new THREE.InstancedMesh(palmGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  im.frustumCulled = false;
  return im;
}

/** Vivid traffic colours for oncoming cars. */
export const TRAFFIC_COLORS = [0x22c55e, 0x3b82f6, 0xf97316, 0xe11d48, 0xfacc15, 0x8b5cf6, 0x06b6d4];
