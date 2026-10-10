/** Things a traveller can opt in to see along their route. Shared by the picker UI and the suggestion service. */
export interface Interest {
  id: string;
  label: string;
  /** LocationIQ nearby `class:type` tags. */
  tags: string[];
}

export const INTERESTS: Interest[] = [
  { id: "sights", label: "Landmarks & sights", tags: ["tourism:attraction", "tourism:viewpoint"] },
  { id: "museums", label: "Museums & galleries", tags: ["tourism:museum", "tourism:gallery"] },
  { id: "heritage", label: "Heritage & history", tags: ["historic:monument", "historic:castle", "historic:fort", "historic:archaeological_site"] },
  { id: "beaches", label: "Beaches & waterfront", tags: ["natural:beach", "leisure:marina"] },
  { id: "nature", label: "Parks & nature", tags: ["leisure:park", "leisure:garden", "leisure:nature_reserve"] },
  { id: "fun", label: "Family fun", tags: ["tourism:theme_park", "tourism:zoo", "tourism:aquarium"] },
  { id: "worship", label: "Temples & churches", tags: ["amenity:place_of_worship"] },
];

export const DEFAULT_INTERESTS = ["sights", "heritage"];

export const DETOUR_CHOICES = [
  { m: 500, label: "≤ 500 m off route" },
  { m: 1000, label: "≤ 1 km off route" },
  { m: 2000, label: "≤ 2 km off route" },
];
