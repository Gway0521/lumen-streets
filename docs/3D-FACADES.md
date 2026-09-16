# Facades and architectural light

[繁體中文](3D-FACADES.zh-TW.md) · [3D architecture](ARCHITECTURE.md)

The nightscape separates interior occupancy, facade material and exterior architectural light. The aim is a recognisable skyline with quiet residential districts, active commercial floors and a small number of luminous crowns. Source building heights and footprints remain unchanged. These are procedural art treatments, not surveyed windows or live lighting data.

## Facade families

| Family | Openings and rhythm | Night material and light |
| --- | --- | --- |
| Residential | Small independent punched openings, generous solid wall | Concrete, warm grey; warm rooms |
| Apartments | Paired windows, slight bay offsets every three storeys | Neutral stone; room-scale occupancy |
| Ribbon office | Broad shallow glazing separated by piers and spandrels | Silver/grey; suites lit across a floor |
| Curtain wall | Large glazing modules with connected office groups | Blue/green glass; neutral and cool white |
| Hotel | Narrow tall openings, repeated room spacing | Limestone/bronze grey; warm rooms and selective crown light |
| Vertical tower | Tall panes grouped between darker vertical piers | Charcoal/glass; selected edges and upper fins |
| Masonry/civic | Narrow arched openings, deeper solid bays | Stone/bronze; warm grazing light |
| Industrial | Broad high-level clerestories, mostly solid lower wall | Grey metal/concrete; restrained lighting |
| Sculpted tower | Staggered glazing and curved light traces | Glass; sparse contour accents |

Mapped building use takes precedence. Missing use is inferred artistically from height, footprint area, outline complexity and a stable seed. Eight muted material tones preserve small differences under the shared night exposure. The exact and instanced paths retain the same selected family, tone and seed; spatially merged low buildings remain approximate.

Exterior light includes crown bands, selected vertical edges, upper fins, curved traces, and soft local wall washing. Most buildings receive no decorative light. Champagne and white dominate; ice blue, jade and violet occur less often. Named landmarks use explicit artistic palettes and component bounds. Non-glazed component beams and spires do not receive windows. Curved component surfaces use cylindrical window coordinates, with seam unwrapping.

Red obstruction lights sit at selected roof corners and actual landmark tips. The height/seed rule is an artistic heuristic, not a jurisdiction-specific aviation assessment. Some lights are steady and others pulse on a two-second simulation cycle; lights on one building share their phase. Pause and export use the existing simulation clock. At most 4,096 points are uploaded in one depth-tested draw.

## References

[ERCO facade lighting](https://www.erco.com/en_us/designing-with-light/public/correctly-illuminating-facades-7226/), [SOM facade design](https://www.som.com/expertise/facade-design/) and [Jin Mao Tower](https://www.som.com/projects/jin-mao-tower/) inform the distinction between occupied interiors, solid walls and selective exterior accents.

## Implementation and review

`src/three/facades.js` selects families and tones. Geometry carries a four-float descriptor per detailed vertex (family/landmark palette, base, top, wall width). This adds at most about 10.7 MiB at the 700,000 desktop vertex limit, or 4.3 MiB at the 280,000 mobile limit. Instanced volumes reuse the existing seed slot to pack the family and add no stride. Warning lights add at most 64 KiB of position/phase attributes, plus a draw call. CPU copies, worker memory and driver overhead are additional.

The shader keeps categorical seeds and facade descriptors flat across triangles. Windows fade into integrated energy at small projected sizes. Thin architectural lights have derivative-based antialiasing and a bounded luminous footprint. Local washing is an emissive facade approximation: it does not cast shadows, illuminate neighbours or add these facades to water reflections. No per-window geometry, new texture downloads or real point lights are required.

Run `node scripts/check-3d-architecture.mjs` with the development server to capture nine production-shader facade samples and actual Sapporo, Shanghai, Taipei and global London views. Output is saved under ignored `artifacts/3d-architecture/`. Also run the facade seed regression, art/export/disposal suite and the normal browser suite. Visual inspection is required; test success alone is not artistic acceptance.
