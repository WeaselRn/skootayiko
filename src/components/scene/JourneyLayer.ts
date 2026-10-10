import * as THREE from "three";
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MlMap } from "maplibre-gl";
import type { Coordinate, RouteOption } from "@/schema/route";
import type { Avatar } from "@/lib/avatar";
import { pathSampler, type PathSampler, type PlayState } from "@/lib/journey";
import { MODE_STYLE } from "@/lib/modes";
import { instantiate, isPerson, loadModel, MODELS, modelForMode, type Instance } from "./models";
import { autoRickshaw, boat, busStop, metroStation, proxy, viaduct, VIADUCT_HEIGHT } from "./procedural";

interface Actor {
  root: THREE.Group;
  /** Real-world reference size (m) used for on-screen exaggeration. */
  size: number;
  person: boolean;
  inst?: Instance;
  traffic: THREE.Group[];
}

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
    for (const g of [this.scene, this.overlay]) {
      const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2);
      hemi.position.set(0, 0, 1);
      g.add(hemi);
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(-0.4, -0.7, 1);
      g.add(sun);
    }
    this.scene.add(this.props);
  }

  onAdd(map: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: !this.lowPower });
    this.renderer.autoClear = false;
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
    this.ensureActor(0);
    this.map?.triggerRepaint();
  }

  /** Builds an actor; models load async and replace a coloured proxy. */
  private makeActor(kind: ReturnType<typeof modelForMode>, color: string): Actor {
    const root = new THREE.Group();
    root.visible = false;
    this.overlay.add(root);
    const actor: Actor = { root, size: 4, person: false, traffic: [] };
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
              if (m?.color) {
                const mm = m.clone();
                mm.color.offsetHSL(k ? 0.55 : 0.15, -0.2, 0.1);
                (o as THREE.Mesh).material = mm;
              }
            });
            car.add(inst.root);
          })
          .catch(() => car.add(proxy(4.2, "#94a3b8")));
      }
    }
    return actor;
  }

  /** The traveller standing at a stop while waiting. */
  private riderActor(): Actor {
    if (!this.rider) this.rider = this.makeActor(this.avatar, "#6b7280");
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
          if (actor.person) {
            this.animatePerson(actor, dt, this.motion.moving);
            needsFrames = true;
          }
          actor.traffic.forEach((car, k) => {
            const f = (1 - st.progress + (k ? 0.35 : 0.7)) % 1;
            const c = sampler.at(f);
            const side = THREE.MathUtils.degToRad(c.bearing + 90);
            const ex = this.exaggeration(actor, c.point.lat);
            const off = 2 + ex;
            car.position.copy(this.local(c.point)).add(new THREE.Vector3(-Math.sin(side) * off, -Math.cos(side) * off, 0));
            car.rotation.z = -THREE.MathUtils.degToRad(c.bearing + 180);
            car.scale.setScalar(ex * 0.8);
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
