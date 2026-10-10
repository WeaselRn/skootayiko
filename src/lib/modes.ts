import type { TransportMode } from "@/schema/route";

export interface ModeStyle {
  label: string;
  /** Line colour on the map and accent in lists. */
  color: string;
  dashed?: boolean;
  /** Short verb for progress UI. */
  verb: string;
}

export const MODE_STYLE: Record<TransportMode, ModeStyle> = {
  walking: { label: "Walk", color: "#6b7280", dashed: true, verb: "Walking" },
  bike_taxi: { label: "Bike taxi", color: "#ea580c", verb: "Riding a bike taxi" },
  auto_rickshaw: { label: "Auto", color: "#ca8a04", verb: "Riding an auto" },
  taxi: { label: "Taxi", color: "#dc2626", verb: "In a taxi" },
  bus: { label: "Bus", color: "#2563eb", verb: "On the bus" },
  metro: { label: "Metro", color: "#0d9488", verb: "On the metro" },
  train: { label: "Train", color: "#7c3aed", verb: "On the train" },
  ferry: { label: "Boat", color: "#0284c7", verb: "On the boat" },
  cycling: { label: "Cycle", color: "#16a34a", verb: "Cycling" },
  unknown: { label: "Other", color: "#71717a", verb: "Travelling" },
};
