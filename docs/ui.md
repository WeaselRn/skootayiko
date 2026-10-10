# UI and 3D journey player

## Pages
| Route | Purpose |
|---|---|
| `/` | Welcome page: animated logo (the "oo" are scooter wheels), a one-line pitch, and the "Let's go" button. |
| `/avatar` | Traveller picker. One Three.js canvas shows both avatars walking circles. Hover makes one run, click makes it jump and selects it, drag spins the stage. Radio buttons mirror the choice for keyboard and screen-reader users. The choice is saved to `localStorage` and also passed as `?avatar=`. |
| `/plan` | Planner and ride mode. |

## Ride mode (game controls)
Press "Ride this route" to start. You move along the planned geometry yourself.

| Input | Action |
|---|---|
| `W` / `↑`, hold | Move forward. During a wait phase it fast-forwards the wait. |
| `S` / `↓` | Move backwards. |
| `A` `D` / `←` `→` | Orbit the camera around the rider. |
| `Shift` | Boost ×4. A walking avatar switches to a run. |
| `Space` | Auto-ride on or off. |
| `C` | Switch between follow camera and free camera. |
| Mouse drag / one-finger drag | Free look: orbit and tilt, 0–85°. |
| Scroll / pinch | Zoom in or out around the rider, up to z23.5. |
| Touch | On-screen GO, BACK and look buttons, shown on coarse pointers only. |

- **Follow camera** is on by default. The rider stays centred while you control zoom, bearing and pitch. If you haven't orbited for 2.5 s while moving, the camera drifts back behind the rider.
- **Close-up zoom per mode:** walk 22.6, bike taxi and auto 21.8, taxi 21.4, bus 20.6, metro 19.6, boat 19.8. Speed scales with zoom, so zooming out makes you travel faster.
- **Checkpoints:** each leg ends with a transfer card. Press W or Enter to continue. The journey ends with an arrival card showing the estimated time and cost.
- The rider and vehicle are drawn in a second pass after a depth clear, so buildings never hide them. Buildings also fade as you zoom in.
- Journey time comes from distance travelled along the leg, so the HUD totals match the plan. The HUD shows how many times faster than real time you are moving and is labelled "Preview · not live".

## Layout
- **Desktop:** a 400 px planner panel on the left and the map on the right.
- **Mobile:** the map takes the top 48 dvh and the panel scrolls below it.
- The player bar floats over the bottom of the map.

## Components
| File | Role |
|---|---|
| `components/Planner.tsx` | Page state: places, search, selected option, player, pick-on-map. |
| `components/search/PlaceInput.tsx` | Debounced (350 ms, at least 3 characters) LocationIQ combobox with keyboard navigation and a "Map" pick button. |
| `components/routes/RouteCard.tsx` | Badges, duration, ₹ range with its source, time-proportional mode strip, and waits. |
| `components/routes/SegmentList.tsx` | Ordered legs, waits, instructions, and per-leg time and fare source and confidence. |
| `components/map/JourneyMap.tsx` | MapLibre (MapTiler `streets-v2`), 3D building extrusions, route and stop layers, active-leg highlight, camera follow. |
| `components/scene/JourneyLayer.ts` | A Three.js custom layer that shares MapLibre's WebGL context. |
| `components/scene/models.ts` | GLB manifest, the loader with meshopt, normalisation (Z-up, real size, facing north). |
| `components/scene/procedural.ts` | Auto-rickshaw, boat, metro viaduct (instanced), stations, bus stop, loading proxy. |
| `components/player/usePlayer.ts`, `PlayerBar.tsx` | Timeline clock, speed, seek, leg stepping. |
| `lib/journey.ts` | Pure timeline builder and arc-length path sampler. It contains no routing logic. |

The UI never computes fares or rankings. It renders `RoutePlanResponse` as it receives it.

## 3D rules
- Only the current leg's vehicle is mounted. The next leg's model is preloaded.
- Mode to asset:
  - walk: man or woman, with the walk clip
  - bike taxi: motorcycle
  - taxi: car
  - auto: procedural auto
  - bus: bus, plus a stop sign at both ends
  - metro: train on a 12 m viaduct, with stations
  - boat: procedural boat
- **Waiting phase:** the rider stands at the stop and no vehicle is shown, because its position is unknown.
- Vehicles follow the leg geometry by arc length and face along the path. They are scaled up at low zoom so they stay about 56 px long, at most ×40.
- Up to 2 oncoming cars appear on road legs. They are disabled on low-power devices.
- **Coordinate frame:** local ENU metres around the first stop. The y mirror lives on a scene group, not the camera, so three.js keeps correct face winding.
- The label "Journey preview · not live" is always shown. The speed readout shows the multiple of real time.

## Accessibility and performance
- With `prefers-reduced-motion`, camera changes are instant cuts and nothing plays automatically.
- Comboboxes, the player and lists have ARIA roles and labels. Leg status is announced with `aria-live`.
- On low-power devices (4 or fewer cores, or 4 GB or less memory), the app turns off MSAA and ambient traffic and limits DPR to 1.5.
- Models are optimised with WebP textures of 512 px or less and meshopt. Total size is about 860 KB, and the animated woman alone is about 540 KB.

## States
| State | What the user sees |
|---|---|
| Idle | Hint text. |
| Loading | Skeleton cards. |
| Error | Alert banner with the server message. |
| No routes | Message. |
| Degraded or mock data | Collapsible warning panel. |
| No MapTiler key | Raw OSM tiles and a notice. |
| Model fails to load | A coloured proxy box. |
| Missing geometry | A straight line. |

## Look and feel
- **Basemap:** cream ground, tropical blue water, leafy greens, and a sky-to-horizon gradient with fog when tilted. A warm light shades the buildings.
- **Buildings:** painted facade patterns (pastel walls with windows and sills) plus clay-tile roof caps. Towers over 28 m get a glass facade. The style's own grey 3D layer is hidden. Tile data merges buildings, so colour comes from id and height buckets.
- **3D props:** instanced coconut palms line walking and road legs, at real size, up to 700 (160 on low-power devices). The viaduct has a teal band, the train wears KMRL white and teal, and the auto-rickshaw and ferry are drawn in detail.
- **Target:** only the traveller or their vehicle is enlarged when you zoom out, together with its pulsing ring, bobbing pin and contact shadow. Traffic, palms and stations stay at true scale.
- **Rendering:** ACES tone mapping and warm sun, sky and rim lighting. Route lines have a soft glow.
