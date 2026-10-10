/** Static Kochi Metro Line 1 geometry served by /api/metro (from the KMRL GTFS feed). */
export interface MetroNetwork {
  /** Full Line 1 alignment, Aluva → Tripunithura. */
  line: { lat: number; lon: number }[];
  stations: { id: string; name: string; lat: number; lon: number }[];
}
