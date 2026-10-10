import * as THREE from "three";
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from "maplibre-gl";
import type { Coordinate, RouteOption } from "@/schema/route";
import type { Avatar } from "@/lib/avatar";
import { pathSampler, type PathSampler, type PlayState } from "@/lib/journey";
import { MODE_STYLE } from "@/lib/modes";
import { instantiate, isPerson, loadModel, MODELS, modelForMode, type Instance } from "./models";
import {
  autoRickshaw,
  boat,
  busStop,
  contactShadow,
  metroStation,
  palmsAlong,
  proxy,
  targetMarker,
  TRAFFIC_COLORS,
  viaduct,
  VIADUCT_HEIGHT,
  type TargetMarker,
} from "./procedural";

interface Actor {
  root: THREE.Group;
  /** Real-world reference size (m) used for on-screen exaggeration. */
  size: number;
  person: boolean;
  inst?: Instance;
  traffic: THREE.Group[];
  marker?: TargetMarker;
}

/** Approximate model heights (m) for placing the target pin. */
const PIN_HEIGHT: Partial<Record<string, number>> = {
  person: 1.9,
  motorcycle: 1.5,
  auto: 2.1,
  car: 1.6,
  bus: 3.4,
  train: 4.3,
  boat: 5.6,
};
/** Road-side legs that get coconut palms. */
const PALM_MODES = new Set(["walking", "bike_taxi", "auto_rickshaw", "taxi", "bus", "cycling"]);

export interface Motion {
  /** True while the rider is actively moving along the route. */
  moving: boolean;
  /** Ratio of current speed to the mode's normal game speed (drives walk-cycle tempo). */
  pace: number;
}

const EARTH_CIRC = 40075016.686;
const VEHICLE_PX = 64;
const PERSON_PX = 40;
const MAX_EXAGGERATION = 40;

/**
 * MapLibre custom layer that renders the selected journey with Three.js in the
 * map's own WebGL context. It only visualises the route geometry it is given;
 * it never moves anything based on live positions.
 */
export class JourneyLayer implements CustomLayerInterface {
  readonly id = "journey-3d";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private map?: MlMap;
  private renderer?: THREE.WebGLRenderer;
  private readonly root = new THREE.Scene();
  /**
   * Local ENU world (x east, y north, z up). Mercator y grows southward, so this group
   * mirrors y; keeping the mirror on an object (not the camera) lets three.js fix face winding.
   */
  private readonly scene = new THREE.Group();
  /**
   * Second pass for the rider/vehicle, drawn after clearing depth so buildings never
   * hide it (the follow camera often sits behind walls at street level).
   */
  private readonly overlayRoot = new THREE.Scene();
  private readonly overlay = new THREE.Group();
  private readonly camera = new THREE.Camera();
  private readonly timer = new THREE.Timer();
  private anchor = MercatorCoordinate.fromLngLat([76.2999, 9.9816], 0);
  private unit = this.anchor.meterInMercatorCoordinateUnits();

  private option: RouteOption | null = null;
  private samplers: PathSampler[] = [];
  private actors = new Map<number, Actor>();
  private props = new THREE.Group();
  private rider?: Actor;
  private state: PlayState | null = null;
  private motion: Motion = { moving: false, pace: 0 };
  private generation = 0;

  constructor(
    private readonly lowPower: boolean,
    private avatar: Avatar,
  ) {
    this.scene.scale.y = -1;
    this.overlay.scale.y = -1;
    this.root.add(this.scene);
    this.overlayRoot.add(this.overlay);
    // Warm tropical light: sky-blue fill from above, sandy bounce from below, low golden sun.
    for (const g of [this.scene, this.overlay]) {
      const hemi = new THREE.HemisphereLight(0xd6ecff, 0xd9c49a, 1.9);
      hemi.position.set(0, 0, 1);
      g.add(hemi);
      const sun = new THREE.DirectionalLight(0xfff0d4, 2.4);
      sun.position.set(-0.5, -0.8, 1);
      g.add(sun);
      const rim = new THREE.DirectionalLight(0xbfe9ff, 0.7);
      rim.position.set(0.6, 0.7, 0.6);
      g.add(rim);
    }
    this.scene.add(this.props);
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: !this.lowPower });
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
  }

  onRemove() {
    this.clearActors();
    this.props.clear();
    this.renderer?.dispose();
  }

  /** Local ENU metres relative to the anchor (x east, y north). */
  private local(c: Coordinate, z = 0): THREE.Vector3 {
    const m = MercatorCoordinate.fromLngLat([c.lon, c.lat], 0);
    return new THREE.Vector3((m.x - this.anchor.x) / this.unit, -(m.y - this.anchor.y) / this.unit, z);
  }

  private clearActors() {
    this.generation++;
    for (const a of this.actors.values()) {
      this.overlay.remove(a.root);
      a.traffic.forEach((t) => this.scene.remove(t));
    }
    this.actors.clear();
    if (this.rider) this.overlay.remove(this.rider.root);
    this.rider = undefined;
  }

  setAvatar(avatar: Avatar) {
    if (avatar === this.avatar) return;
    this.avatar = avatar;
    this.clearActors();
    if (this.state) this.setState(this.state, this.motion);
  }

  setJourney(option: RouteOption | null) {
    this.clearActors();
    this.props.clear();
    this.option = option;
    this.state = null;
    if (!option) return this.map?.triggerRepaint();
    const o = option.segments[0].origin.location;
    this.anchor = MercatorCoordinate.fromLngLat([o.lon, o.lat], 0);
    this.unit = this.anchor.meterInMercatorCoordinateUnits();
    this.samplers = option.segments.map((s) => pathSampler(s));

    // Static context: only for transit legs of this journey.
    option.segments.forEach((s, i) => {
      if (s.mode === "metro") {
        const pts = (s.geometry.length >= 2 ? s.geometry : [s.origin.location, s.destination.location]).map((c) => {
          const v = this.local(c);
          return new THREE.Vector2(v.x, v.y);
        });
        this.props.add(viaduct(pts));
        for (const f of [0, 1]) {
          const st = metroStation(VIADUCT_HEIGHT);
          const smp = this.samplers[i].at(f);
          st.position.copy(this.local(smp.point));
          st.rotation.z = -THREE.MathUtils.degToRad(smp.bearing);
          this.props.add(st);
        }
      }
      if (s.mode === "bus") {
        for (const end of [s.origin.location, s.destination.location]) {
          const p = busStop();
          p.position.copy(this.local(end)).add(new THREE.Vector3(3, 0, 0));
          this.props.add(p);
        }
      }
    });
    // Coconut palms line road and walking legs (real size; they never get exaggerated).
    const budget = this.lowPower ? 160 : 700;
    const roadLen = option.segments.reduce((a, s, i) => a + (PALM_MODES.has(s.mode) ? this.samplers[i].length : 0), 0) || 1;
    option.segments.forEach((s, i) => {
      if (!PALM_MODES.has(s.mode)) return;
      const pts = (s.geometry.length >= 2 ? s.geometry : [s.origin.location, s.destination.location]).map((c) => {
        const v = this.local(c);
        return new THREE.Vector2(v.x, v.y);
      });
      const max = Math.ceil((budget * this.samplers[i].length) / roadLen);
      const palms = palmsAlong(pts, s.mode === "walking" ? 18 : 26, s.mode === "walking" ? 5 : 8, max, i + 1);
      if (palms) this.props.add(palms);
    });
    this.ensureActor(0);
    this.map?.triggerRepaint();
  }

  /** Builds an actor; models load async and replace a coloured proxy. */
  private makeActor(kind: ReturnType<typeof modelForMode>, color: string): Actor {
    const root = new THREE.Group();
    root.visible = false;
    this.overlay.add(root);
    const actor: Actor = { root, size: 4, person: false, traffic: [] };
    const person = kind === "man" || kind === "woman";
    const size = kind === "auto" ? 2.7 : kind === "boat" ? 14 : kind ? MODELS[kind].size : 3;
    const w = person ? 1.1 : kind === "boat" ? 5.5 : kind === "train" ? 3.6 : kind === "bus" ? 3.2 : kind === "motorcycle" ? 1 : 2.2;
    root.add(contactShadow(w * 1.25, person ? 1.1 : size * 1.08));
    actor.marker = targetMarker(color, person ? 0.85 : Math.max(1.2, w * 0.75), PIN_HEIGHT[person ? "person" : (kind ?? "car")] ?? 2);
    root.add(actor.marker.group);
    if (kind === "auto") {
      root.add(autoRickshaw());
      actor.size = 2.6;
    } else if (kind === "boat") {
      root.add(boat());
      actor.size = 14;
    } else if (kind) {
      const spec = MODELS[kind];
      actor.size = spec.size;
      actor.person = isPerson(kind);
      const ph = proxy(actor.person ? 0.5 : spec.size, color);
      root.add(ph);
      const gen = this.generation;
      loadModel(kind)
        .then((gltf) => {
          if (gen !== this.generation) return;
          const inst = instantiate(kind, gltf);
          if (actor.person) inst.play("idle", 0);
          root.remove(ph);
          root.add(inst.root);
          actor.inst = inst;
          this.map?.triggerRepaint();
        })
        .catch(() => {
          /* keep proxy: a missing model must not break the ride */
        });
    } else {
      root.add(proxy(3, color));
    }
    return actor;
  }

  private ensureActor(i: number): Actor | undefined {
    if (!this.option || i < 0 || i >= this.option.segments.length) return;
    const existing = this.actors.get(i);
    if (existing) return existing;
    const seg = this.option.segments[i];
    const actor = this.makeActor(modelForMode(seg.mode, this.avatar), MODE_STYLE[seg.mode].color);
    this.actors.set(i, actor);

    // Light oncoming traffic on road legs only.
    if (!this.lowPower && ["bus", "taxi", "bike_taxi", "auto_rickshaw"].includes(seg.mode)) {
      for (let k = 0; k < 2; k++) {
        const car = new THREE.Group();
        car.visible = false;
        this.scene.add(car);
        actor.traffic.push(car);
        loadModel("car")
          .then((g) => {
            const inst = instantiate("car", g);
            inst.root.traverse((o) => {
              const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
              // Body panels get a vivid paint; glass/tyres (dark) keep theirs.
              if (m?.color && m.color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.25) {
                const mm = m.clone();
                mm.color.setHex(TRAFFIC_COLORS[(i * 2 + k) % TRAFFIC_COLORS.length]);
                (o as THREE.Mesh).material = mm;
              }
            });
            car.add(contactShadow(2.4, 4.6));
            car.add(inst.root);
          })
          .catch(() => car.add(proxy(4.2, "#94a3b8")));
      }
    }
    return actor;
  }

  /** The traveller standing at a stop while waiting. */
  private riderActor(): Actor {
    if (!this.rider) this.rider = this.makeActor(this.avatar, "#0d9488");
    return this.rider;
  }

  setState(state: PlayState, motion: Motion) {
    if (!this.option || state.segment >= this.option.segments.length) return;
    this.state = state;
    this.motion = motion;
    this.ensureActor(state.segment);
    this.ensureActor(state.segment + 1); // preload next leg
    this.map?.triggerRepaint();
  }

  private exaggeration(actor: Actor, lat: number): number {
    const z = this.map?.getZoom() ?? 16;
    const mpp = (EARTH_CIRC * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** z);
    const want = ((actor.person ? PERSON_PX : VEHICLE_PX) * mpp) / actor.size;
    // Never shrink below real size: when zoomed right in you see the true-scale model.
    return THREE.MathUtils.clamp(want, 1, MAX_EXAGGERATION);
  }

  private place(actor: Actor, at: Coordinate, bearing: number, zBase: number) {
    actor.root.position.copy(this.local(at, zBase));
    actor.root.rotation.z = -THREE.MathUtils.degToRad(bearing);
    actor.root.scale.setScalar(this.exaggeration(actor, at.lat));
    actor.root.visible = true;
  }

  private animatePerson(actor: Actor, dt: number, moving: boolean) {
    const inst = actor.inst;
    if (!inst?.mixer) return;
    if (moving) {
      inst.play(this.motion.pace > 1.8 ? "run" : "walk");
      inst.mixer.timeScale = THREE.MathUtils.clamp(this.motion.pace, 0.5, 1.6);
    } else {
      inst.play("idle");
      inst.mixer.timeScale = 1;
    }
    inst.mixer.update(dt);
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.renderer || !this.map) return;
    this.timer.update();
    const dt = Math.min(0.1, this.timer.getDelta());
    for (const a of this.actors.values()) {
      a.root.visible = false;
      a.traffic.forEach((t) => (t.visible = false));
    }
    if (this.rider) this.rider.root.visible = false;

    let needsFrames = false;
    const now = performance.now() / 1000;
    for (const a of [...this.actors.values(), this.rider]) a?.marker?.update(now);
    const st = this.state;
    if (this.option && st) {
      const seg = this.option.segments[st.segment];
      const sampler = this.samplers[st.segment];
      if (!seg || !sampler) return;
      const zBase = seg.mode === "metro" ? VIADUCT_HEIGHT : 0;
      if (st.kind === "wait") {
        // Rider waits at the stop; the vehicle is not shown because we do not know where it is.
        const p = this.riderActor();
        const at = sampler.at(0);
        this.place(p, at.point, at.bearing, zBase);
        this.animatePerson(p, dt, false);
        needsFrames = true;
      } else {
        const actor = this.actors.get(st.segment);
        if (actor) {
          const at = sampler.at(st.progress);
          this.place(actor, at.point, at.bearing, zBase);
          needsFrames = true; // marker pulse
          if (actor.person) {
            this.animatePerson(actor, dt, this.motion.moving);
            needsFrames = true;
          }
          actor.traffic.forEach((car, k) => {
            const f = (1 - st.progress + (k ? 0.35 : 0.7)) % 1;
            const c = sampler.at(f);
            const side = THREE.MathUtils.degToRad(c.bearing + 90);
            // Background traffic stays at real size; only the traveller is enlarged when zoomed out.
            const off = 3.4;
            car.position.copy(this.local(c.point)).add(new THREE.Vector3(-Math.sin(side) * off, -Math.cos(side) * off, 0));
            car.rotation.z = -THREE.MathUtils.degToRad(c.bearing + 180);
            car.scale.setScalar(1);
            car.visible = car.children.length > 0;
          });
        }
      }
    }

    const mvp = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]);
    const local = new THREE.Matrix4()
      .makeTranslation(this.anchor.x, this.anchor.y, this.anchor.z)
      .scale(new THREE.Vector3(this.unit, this.unit, this.unit));
    this.camera.projectionMatrix = mvp.multiply(local);
    this.renderer.resetState();
    this.renderer.render(this.root, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.overlayRoot, this.camera);
    // Idle/walk cycles need frames even when the camera is still.
    if (this.motion.moving || (needsFrames && !this.lowPower)) this.map.triggerRepaint();
  }
}
