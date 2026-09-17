export function roadWidth(t) {
  return (
    {
      motorway: 25,
      trunk: 24,
      primary: 23,
      secondary: 20,
      tertiary: 15,
      residential: 8,
      unclassified: 8,
      service: 5,
      living_street: 6,
      pedestrian: 7,
      footway: 2.8,
      path: 2,
      cycleway: 3,
      steps: 2,
    }[t.highway] || 5
  );
}
