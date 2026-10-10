"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Avatar } from "@/lib/avatar";
import { instantiate, loadModel, type Instance } from "@/components/scene/models";

interface Props {
  selected: Avatar | null;
  onSelect(a: Avatar): void;
  onHover?(a: Avatar | null): void;
}

const AVATARS: { key: Avatar; x: number; ring: string }[] = [
  { key: "man", x: -1.3, ring: "#0d9488" },
  { key: "woman", x: 1.3, ring: "#f97357" },
];
const WALK_RADIUS = 0.42;

/**
 * Small showroom: both avatars walk circles on pedestals.
 * Hover = run, click = jump + select, drag = orbit the stage.
 */
export default function AvatarStage({ selected, onSelect, onHover }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const cb = useRef({ onSelect, onHover });
  cb.current = { onSelect, onHover };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "pan-y";
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.up.set(0, 0, 1);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xd9c7a3, 2.4);
    hemi.position.set(0, 0, 1);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(-3, -4, 6);
    scene.add(sun);

    type Slot = {
      key: Avatar;
      centre: THREE.Vector3;
      ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
      hit: THREE.Mesh;
      inst?: Instance;
      theta: number;
    };
    const slots: Slot[] = AVATARS.map((a, i) => {
      const centre = new THREE.Vector3(a.x, 0, 0);
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 1.02, 0.14, 48),
        new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.9 }),
      );
      disc.rotation.x = Math.PI / 2;
      disc.position.set(a.x, 0, -0.07);
      scene.add(disc);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.98, 0.035, 12, 64),
        new THREE.MeshStandardMaterial({ color: a.ring, emissive: a.ring, emissiveIntensity: 0.1 }),
      );
      ring.position.set(a.x, 0, 0.005);
      scene.add(ring);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2.2, 12), new THREE.MeshBasicMaterial({ visible: false }));
      hit.rotation.x = Math.PI / 2;
      hit.position.set(a.x, 0, 1.1);
      hit.userData.key = a.key;
      scene.add(hit);
      const slot: Slot = { key: a.key, centre, ring, hit, theta: i * Math.PI };
      loadModel(a.key)
        .then((g) => {
          slot.inst = instantiate(a.key, g);
          scene.add(slot.inst.root);
        })
        .catch(() => {});
      return slot;
    });

    // Camera orbit state.
    let az = -Math.PI / 2;
    let azTarget = az;
    let elev = 0.32;
    const target = new THREE.Vector3(0, 0, 0.85);
    const placeCamera = () => {
      const d = 7.4;
      camera.position.set(
        target.x + Math.cos(az) * Math.cos(elev) * d,
        target.y + Math.sin(az) * Math.cos(elev) * d,
        target.z + Math.sin(elev) * d,
      );
      camera.lookAt(target);
    };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // Pull back on narrow screens so both avatars fit.
      camera.fov = w / h < 1 ? 42 : 30;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Pointer: hover, click, drag-to-orbit.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let hovered: Avatar | null = null;
    let drag: { x: number; moved: boolean } | null = null;
    const pick = (e: PointerEvent): Avatar | null => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(slots.map((s) => s.hit))[0];
      return (hit?.object.userData.key as Avatar) ?? null;
    };
    const setHover = (h: Avatar | null) => {
      if (h === hovered) return;
      hovered = h;
      renderer.domElement.style.cursor = h ? "pointer" : drag ? "grabbing" : "grab";
      cb.current.onHover?.(h);
    };
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, moved: false };
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x;
        if (Math.abs(dx) > 3) drag.moved = true;
        drag.x = e.clientX;
        azTarget -= dx * 0.01;
      }
      setHover(pick(e));
    };
    const up = (e: PointerEvent) => {
      const wasDrag = drag?.moved;
      drag = null;
      if (wasDrag) return;
      const k = pick(e);
      if (!k) return;
      cb.current.onSelect(k);
      slots.find((s) => s.key === k)?.inst?.once("jump", "walk");
    };
    const leave = () => setHover(null);
    const c = renderer.domElement;
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointerleave", leave);
    c.style.cursor = "grab";

    const clock = new THREE.Timer();
    let raf = 0;
    const tick = (now: number) => {
      clock.update(now);
      const dt = Math.min(0.05, clock.getDelta());
      az += (azTarget - az) * Math.min(1, dt * 8);
      placeCamera();
      for (const s of slots) {
        const isSel = selectedRef.current === s.key;
        const isHov = hovered === s.key;
        s.ring.material.emissiveIntensity += ((isSel ? 0.9 : isHov ? 0.45 : 0.1) - s.ring.material.emissiveIntensity) * Math.min(1, dt * 8);
        const sc = isSel ? 1.06 : 1;
        s.ring.scale.setScalar(s.ring.scale.x + (sc - s.ring.scale.x) * Math.min(1, dt * 8));
        const inst = s.inst;
        if (!inst) continue;
        if (inst.current === "walk" || inst.current === "run") inst.play(isHov ? "run" : "walk");
        const speed = reduced ? 0 : inst.current === "run" ? 2.1 : inst.current === "jump" ? 0.4 : 0.85;
        s.theta += speed * dt;
        inst.root.position.set(s.centre.x + Math.cos(s.theta) * WALK_RADIUS, s.centre.y + Math.sin(s.theta) * WALK_RADIUS, 0);
        inst.root.rotation.z = s.theta;
        inst.mixer?.update(dt);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointerleave", leave);
      renderer.dispose();
      c.remove();
    };
  }, []);

  return <div ref={host} className="h-full w-full" />;
}
