# Product requirements: Skootayiko (Kochi multimodal journey planner)

## Problem
People in Kochi combine the metro, private and KSRTC buses, boats, bike taxis, autos and taxis. No single tool shows door-to-door options with total time **and** total cost. Map apps also make transfers hard to follow.

## Users and core job
A commuter or visitor enters A and B. They then:
1. compare a few plausible options by estimated time and cost,
2. pick one and see each leg and transfer,
3. optionally watch a short 3D preview of the journey.

## Success criterion
A user enters A and B, compares plausible multimodal options by estimated time and cost, selects a route, and watches a clear, lightweight 3D visualisation of its ordered segments.

## In scope (v1)
- Place search (LocationIQ, limited to the Kochi area) and picking a place on the map.
- Departure "now" or at a chosen IST time.
- Route options: transit (metro, bus, boat) with walk or bike-taxi first/last mile, plus direct bike taxi, auto, taxi and walking.
- Labels: fastest, cheapest and balanced.
- Totals: duration including waits, and a cost range. Each figure shows its source and confidence.
- 2D map with route lines, stops and the active leg.
- 3D journey preview with play/pause, scrub, speed, leg stepping and camera follow.
- Clear loading, empty, error, degraded-data and mock-data states.

## Out of scope (v1)
Gamification, booking or payment, live vehicle tracking, user accounts, and generating new 3D models per trip.

## Principles
- **Honest data.** Every time and fare is labelled as timetable, provider estimate or model estimate. Expired feeds are disclosed. The 3D view is always labelled "Journey preview · not live".
- **Utility first.** Correct totals and understandable transfers come before visual effects.
- **Lightweight.** The 3D scene shows one vehicle, a little context, and nothing else.

## Known data limits (verified 2026-10-10)
- KMRL GTFS ends 2025-12-31 and Jungle Bus GTFS ends 2023-03-25. Both are used as typical timetables.
- Bus headways are a uniform 60-minute placeholder. The app assumes a 20-minute headway instead.
- There is no bus, boat or ride-hailing fare API. Those fares are ranges from `config/fares.json`.
- No GTFS-Realtime feed is known for Kochi.
