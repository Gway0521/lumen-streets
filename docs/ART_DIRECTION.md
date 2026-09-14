# Art direction

Lumen Streets is an artistic aerial view of a city at night. Street structure should make each place recognizable, and the light should be comfortable to watch.

## Light and movement

- **Connected streets.** Major roads form continuous warm ribbons, with gentle changes through amber, gold and pale yellow. Thin luminous shoulders frame darker asphalt; staggered lamps have small halos. Side streets and paths are fainter.
- **Distinct districts.** Stations and commercial areas can be bright; residential areas are quieter. Water and parks hold large dark areas.
- **Restrained highlights.** Intersections retain road detail. A few mapped landmarks add ivory, pale blue or pale green accents.
- **Readable motion.** White headlights, red tail lights and trains remain visible at wallpaper size. The underground overlay uses dashed tracks.
- **Shared rules.** Map geometry and tags determine the scene across all cities. Lighting is an artistic interpretation of those features.

## Aerial depth

Aerial Gold uses a high-angle orthographic camera for new scenes. Ground and buildings share foreshortening; roofs rise towards the northwest, revealing shaded facades, irregularly occupied floors and warm shopfronts. Recessed roof decks, parapets and small equipment align with the footprint. Cool, subdued roofs keep the warm streets dominant; quiet districts also have darker roof surfaces. Saved aerial-7 scenes retain the earlier oblique view until explicitly upgraded.

Credible heights retain their proportions under one fixed projection scale. Reviewed landmark heights take priority, followed by mapped heights, floor estimates and conservative type/footprint defaults. District lighting does not change building height. Taipei 101 has a low podium and segmented tower; Sapporo has an open frame. Shanghai adds Oriental Pearl's spheres and open columns, Shanghai Tower's taper and twist, the World Financial Center's sky portal and Jin Mao's setbacks. Steel, glass and enclosed platforms receive different shading. These original silhouettes prioritize wallpaper-scale recognition over complete architectural detail. See [Buildings](BUILDINGS.md).

Ground geography and traffic routes retain their original coordinates. Projected roofs, facades and rods occlude moving lights; courtyards and frame openings retain transparency. Static face ordering compares elevations where silhouettes overlap, with a deterministic fallback for intersecting structures. It is not a general 3D depth buffer.

Mapped vegetation receives subdued canopy texture. Water carries sparse ripples and short reflections from nearby street lamps, leaving the open river dark. Avoid uniform illumination, fully luminous building outlines and detail that competes with the street hierarchy. Amber and Blue retain their existing flat illustration styles.

Landmark labels use names already present in the map, preferring the selected language and falling back to the source name. Labels avoid each other and the editor controls.

## Composition and interface

The city fills the view. Controls stay compact, with keyboard access, reduced-motion support and layouts for narrow screens. English and Traditional Chinese receive the same functionality.

Wallpapers start with text and edge dimming off. Optional place titles use Cormorant Garamond and Noto Serif TC, warm ivory text and a soft local shade. Titles wrap within safe margins and remain clear of source credit. **Room for icons** softly darkens one edge while preserving the streets beneath it.

## Visual identity

<img src="../public/favicon.svg" width="96" height="96" alt="Lumen Streets street monogram">

Use `public/favicon.svg` as the master mark, preserving its proportions and negative space. Pair it with **Lumen Streets** when the project name is not otherwise visible. Leave at least one quarter of the mark's width around it.

| Colour | Value |
| --- | --- |
| Midnight | `#0b161e` |
| Muted gold | `#d6b77d` |
| Blue grey | `#859d9f` |
| Ivory | `#f2dfb3` |

The mark is project artwork covered by the [project license](../LICENSE). Map and font licenses are listed in [Attribution](../ATTRIBUTION.md).

## Reviewing artwork

Use the [gallery](../public/gallery/sapporo.png) as a reference. Compare the same map, camera, palette, density, seed, simulation time and output size before and after a change. The full-area study export uses 1600×1600 pixels, seed 29, 880 cars and 40 simulated seconds.

Check Tokyo's density, Sapporo's grid and park, Shanghai's river, Beijing's courtyards, Seattle's angled roads and Washington's radial avenues. Include Taipei for landmark changes, and inspect landscape and portrait crops. Look for continuous roads, distinct districts, restrained bloom and legible moving lights.

See [Testing](TESTING.md) for export checks and rebuilding the public artwork.
