import * as THREE from "three";

/** Tiny procedural props. All in local metres, Z up, facing +Y (north). */

const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...opts });

function box(w: number, l: number, h: number, m: THREE.Material, z = 0, y = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, l, h), m);
  mesh.position.set(0, y, z + h / 2);
  return mesh;
}

function wheel(x: number, y: number, r: number, m: THREE.Material): THREE.Mesh {
  const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.18, 12), m);
  w.rotation.z = Math.PI / 2;
  w.position.set(x, y, r);
  return w;
}

/** Kerala-style auto-rickshaw: yellow/black three-wheeler, ~2.6 m long. */
export function autoRickshaw(): THREE.Group {
  const g = new THREE.Group();
  const black = mat(0x111111);
  g.add(box(1.3, 2.4, 0.9, mat(0xf2c200), 0.35));
  g.add(box(1.35, 1.9, 0.08, black, 1.55, -0.15));
  const pillar = (x: number, y: number) => {
    const p = box(0.06, 0.06, 0.4, black, 1.15);
    p.position.x = x;
    p.position.y = y;
    return p;
  };
  g.add(pillar(0.6, 0.75), pillar(-0.6, 0.75), pillar(0.6, -1.0), pillar(-0.6, -1.0));
  g.add(wheel(0, 1.05, 0.3, black), wheel(0.6, -0.8, 0.3, black), wheel(-0.6, -0.8, 0.3, black));
  return g;
}

/** Small passenger boat / Ro-Ro: white hull with a blue cabin, ~14 m long. */
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
  const stripe = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false }), mat(0x0369a1));
  stripe.position.z = 1.4;
  g.add(stripe);
  g.add(box(3.6, 7, 2.0, mat(0x38bdf8, { transparent: true, opacity: 0.9 }), 1.65, -1));
  g.add(box(3.8, 7.4, 0.15, mat(0x0c4a6e), 3.65, -1));
  return g;
}

/** Bus stop post with a sign. */
export function busStop(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.12, 0.12, 2.6, mat(0x334155)));
  g.add(box(0.9, 0.08, 0.6, mat(0x2563eb), 2.2));
  return g;
}

/** Elevated metro station platform block. */
export function metroStation(height: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(14, 70, 0.8, mat(0xe2e8f0), height - 0.8));
  g.add(box(14.5, 72, 0.3, mat(0x0d9488, { transparent: true, opacity: 0.35, depthWrite: false }), height + 4.5));
  for (const y of [-30, -10, 10, 30]) {
    const c = box(1.2, 1.2, height - 0.8, mat(0xcbd5e1));
    c.position.y = y;
    g.add(c);
  }
  return g;
}

export const VIADUCT_HEIGHT = 12;

/** Instanced viaduct (deck + pillars) along a polyline given in local metres. */
export function viaduct(points: THREE.Vector2[]): THREE.Group {
  const g = new THREE.Group();
  if (points.length < 2) return g;
  const deckMat = mat(0xd4d4d8);
  const pillarMat = mat(0xa1a1aa);
  const decks: THREE.Matrix4[] = [];
  const pillars: THREE.Matrix4[] = [];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = a.distanceTo(b);
    if (len < 0.01) continue;
    const ang = Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    decks.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(mid.x, mid.y, VIADUCT_HEIGHT - 0.6),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang),
        new THREE.Vector3(8, len + 0.5, 1.2),
      ),
    );
    for (let d = 30 - carry; d < len; d += 30) {
      const p = a.clone().lerp(b, d / len);
      pillars.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(p.x, p.y, (VIADUCT_HEIGHT - 1.2) / 2),
          new THREE.Quaternion(),
          new THREE.Vector3(1.6, 1.6, VIADUCT_HEIGHT - 1.2),
        ),
      );
    }
    carry = (carry + len) % 30;
  }
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const deck = new THREE.InstancedMesh(unit, deckMat, decks.length);
  decks.forEach((m, i) => deck.setMatrixAt(i, m));
  const pil = new THREE.InstancedMesh(unit, pillarMat, Math.max(1, pillars.length));
  pillars.forEach((m, i) => pil.setMatrixAt(i, m));
  pil.count = pillars.length;
  g.add(deck, pil);
  return g;
}

/** Placeholder shown while a model loads or if it fails. */
export function proxy(length: number, color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(box(Math.max(0.6, length * 0.35), length, Math.max(1, length * 0.25), mat(new THREE.Color(color).getHex())));
  return g;
}
