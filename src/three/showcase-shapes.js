// Original, metre-scale silhouettes. Details are deliberately simplified for aerial views.
// Each assembly uses the same bounded component primitives and shared GPU materials.
export function showcaseProfile(record) {
  const { id, height: h, width: w, depth: d } = record;
  const c = [];
  const loft = (
    sections,
    material = "glass",
    shape = "rectangle",
    windows = true,
  ) =>
    c.push({
      kind: "loft",
      shape,
      material,
      windows,
      sections: sections.map((s) => [
        s[0],
        s[1],
        s[2],
        s[3] || 0,
        s[4] || 0,
        s[5] || 0,
      ]),
    });
  const box = (z, top, width, depth, x = 0, y = 0, material = "glass") =>
    loft(
      [
        [z, width, depth, 0, x, y],
        [top, width, depth, 0, x, y],
      ],
      material,
      "rectangle",
      material === "glass" || material === "stone",
    );
  const beam = (a, b, radius = 1, material = "silver") =>
    c.push({ kind: "beam", a, b, radius, material });
  const sphere = (center, radii, material = "silver") =>
    c.push({ kind: "ellipsoid", center, radii, material });
  const spire = (bottom, top = h, x = 0, y = 0) =>
    beam([x, y, bottom], [x, y, top], 1.2, "ivory");
  const crown = (z, top, width, depth, material = "green-roof", x = 0, y = 0) =>
    loft(
      [
        [z, width, depth, 0, x, y],
        [top, 0.5, 0.5, 0, x, y],
      ],
      material,
      "rectangle",
      false,
    );
  const setbacks = (levels, material = "stone") => {
    let z = 0;
    for (const [top, width, depth] of levels) {
      box(z, top, width, depth, 0, 0, material);
      z = top;
    }
  };
  switch (id) {
    case "nan-shan":
      box(0, 20, w, d);
      box(20, h * 0.88, w * 0.65, d * 0.75);
      loft(
        [
          [h * 0.88, w * 0.65, d * 0.75],
          [h, w * 0.14, d * 0.24],
        ],
        "silver",
      );
      for (const x of [-w * 0.28, w * 0.28])
        box(20, h * 0.94, w * 0.09, d * 0.7, x);
      break;
    case "taipei-dome":
      box(0, 15, w * 0.88, d * 0.88, 0, 0, "stone");
      loft(
        [
          [10, w * 0.92, d * 0.92],
          [24, w, d],
          [h * 0.8, w * 0.72, d * 0.72],
          [h, 2, 2],
        ],
        "silver",
        "ellipse",
        false,
      );
      break;
    case "sun-yat-sen":
      box(0, h * 0.63, w * 0.72, d * 0.72, 0, 0, "stone");
      loft(
        [
          [h * 0.62, w, d],
          [h * 0.8, w * 0.73, d * 0.75],
          [h, w * 0.6, 1],
        ],
        "ivory",
        "rectangle",
        false,
      );
      for (const x of [-w * 0.45, w * 0.45])
        beam(
          [x, -d * 0.43, h * 0.62],
          [x * 1.06, -d * 0.47, h * 0.82],
          1.5,
          "ivory",
        );
      break;
    case "taipei-city-hall":
      for (const x of [-w * 0.32, w * 0.32])
        box(0, h, w * 0.3, d, x, 0, "stone");
      box(0, h * 0.65, w, d * 0.23, 0, 0, "stone");
      break;
    case "sapporo-jr":
      box(0, 36, w, d, 0, 0, "stone");
      box(36, h - 9, w * 0.5, d * 0.73, w * 0.12, 0, "stone");
      box(h - 9, h, w * 0.52, d * 0.75, w * 0.12);
      break;
    case "sapporo-clock":
      box(0, h * 0.52, w, d, 0, 0, "ivory");
      loft(
        [
          [h * 0.52, w * 1.05, d * 1.05],
          [h * 0.75, 0.2, d * 1.05],
        ],
        "rose",
        "rectangle",
        false,
      );
      box(h * 0.45, h * 0.83, 6, 6, 0, d * 0.27, "clock");
      crown(h * 0.83, h, 8, 8, "rose", 0, d * 0.27);
      break;
    case "hokkaido-office":
      box(0, h * 0.54, w, d * 0.58, 0, 0, "rose");
      for (const x of [-w * 0.4, w * 0.4]) {
        box(0, h * 0.58, w * 0.2, d, x, 0, "rose");
        crown(h * 0.58, h * 0.78, w * 0.23, d * 1.05, "green-roof", x);
      }
      loft(
        [
          [h * 0.5, w, d * 0.65],
          [h * 0.72, w, 0.2],
        ],
        "green-roof",
        "rectangle",
        false,
      );
      box(h * 0.54, h * 0.78, 11, 11, 0, 0, "rose");
      sphere([0, 0, h * 0.83], [8, 8, h * 0.14], "green-roof");
      spire(h * 0.92);
      break;
    case "shanghai-convention":
      box(0, h * 0.55, w * 0.75, d * 0.7, 0, 0, "stone");
      for (const x of [-w * 0.36, w * 0.36])
        sphere([x, 0, h * 0.53], [h * 0.47, h * 0.47, h * 0.47], "silver");
      break;
    case "bund-customs":
      box(0, h * 0.52, w, d, 0, 0, "stone");
      box(h * 0.52, h * 0.76, w * 0.28, d * 0.3, 0, -d * 0.25, "stone");
      box(h * 0.76, h * 0.9, w * 0.25, d * 0.26, 0, -d * 0.25, "clock");
      crown(h * 0.9, h, w * 0.29, d * 0.3, "green-roof", 0, -d * 0.25);
      break;
    case "peace-hotel":
      box(0, h * 0.64, w, d, 0, 0, "stone");
      box(h * 0.64, h * 0.78, w * 0.5, d * 0.5, 0, 0, "stone");
      crown(h * 0.78, h, w * 0.5, d * 0.5);
      break;
    case "canton-tower": {
      const levels = Array.from({ length: 13 }, (_, i) => {
        const t = i / 12;
        return [t * 450, 15 + 21 * Math.pow(2 * t - 1, 2), t * 1.05];
      });
      for (let i = 0; i < 16; i++)
        for (let j = 1; j < levels.length; j++) {
          const p = ([z, r, twist]) => [
            r * Math.cos((i * Math.PI) / 8 + twist),
            r * 0.73 * Math.sin((i * Math.PI) / 8 + twist),
            z,
          ];
          beam(p(levels[j - 1]), p(levels[j]), 0.65, i % 3 ? "silver" : "rose");
        }
      for (const [z, r, twist] of levels)
        for (let i = 0; i < 16; i++)
          beam(
            [
              r * Math.cos((i * Math.PI) / 8 + twist),
              r * 0.73 * Math.sin((i * Math.PI) / 8 + twist),
              z,
            ],
            [
              r * Math.cos(((i + 1) * Math.PI) / 8 + twist),
              r * 0.73 * Math.sin(((i + 1) * Math.PI) / 8 + twist),
              z,
            ],
            0.45,
          );
      loft(
        [
          [0, 18, 18],
          [430, 18, 18],
        ],
        "glass",
        "ellipse",
      );
      loft(
        [
          [428, 57, 42],
          [450, 59, 43],
        ],
        "glass",
        "ellipse",
      );
      spire(450);
      break;
    }
    case "guangzhou-ifc":
      loft(
        [
          [0, w, d],
          [h * 0.6, w * 0.93, d * 0.93],
          [h * 0.97, w * 0.66, d * 0.66],
          [h, w * 0.57, d * 0.57],
        ],
        "glass",
        "rounded-triangle",
      );
      break;
    case "guangzhou-ctf":
      setbacks(
        [
          [h * 0.12, w, d],
          [h * 0.7, w * 0.73, d * 0.77],
          [h * 0.87, w * 0.63, d * 0.65],
          [h, w * 0.53, d * 0.52],
        ],
        "glass",
      );
      for (const x of [-w * 0.3, w * 0.3])
        box(h * 0.12, h * 0.85, 2.5, d * 0.65, x, 0, "ivory");
      break;
    case "guangzhou-opera":
      loft(
        [
          [0, w * 0.73, d * 0.75, -12, -w * 0.1],
          [h * 0.48, w * 0.79, d * 0.8, 8, -w * 0.1],
          [h, w * 0.26, d * 0.23, 20, -w * 0.2],
        ],
        "silver",
      );
      loft(
        [
          [0, w * 0.36, d * 0.5, 20, w * 0.35, d * 0.22],
          [h * 0.61, w * 0.3, d * 0.3, 35, w * 0.3, d * 0.22],
          [h * 0.72, 2, 2, 0, w * 0.25, d * 0.22],
        ],
        "stone",
      );
      break;
    case "guangdong-museum":
      box(0, h * 0.24, w * 0.53, d * 0.55, 0, 0, "stone");
      box(h * 0.24, h, w, d, 0, 0, "rose");
      for (let i = 0; i < 7; i++)
        box(
          h * (0.35 + (i % 3) * 0.09),
          h * (0.5 + (i % 3) * 0.09),
          w * 0.075,
          1.5,
          w * (i / 8 - 0.38),
          d * 0.502,
          "silver",
        );
      break;
    case "kaohsiung-85":
      box(0, 30, w, d);
      for (const x of [-w * 0.28, w * 0.28])
        box(30, 210, w * 0.34, d * 0.64, x);
      box(145, 220, w * 0.78, d * 0.6);
      box(220, 320, w * 0.42, d * 0.53);
      crown(320, 348, w * 0.46, d * 0.57, "jade");
      spire(348);
      break;
    case "kaohsiung-music":
      box(0, h * 0.24, w, d, 0, 0, "stone");
      loft(
        [
          [0, w * 0.4, d * 0.5, 0, -w * 0.22],
          [h * 0.72, w * 0.32, d * 0.49, 20, -w * 0.22],
          [h, w * 0.12, d * 0.2, 20, -w * 0.22],
        ],
        "silver",
      );
      loft(
        [
          [0, w * 0.39, d * 0.45, 0, w * 0.24],
          [h * 0.57, w * 0.3, d * 0.37, -16, w * 0.24],
          [h * 0.7, w * 0.13, d * 0.2, -16, w * 0.24],
        ],
        "ivory",
      );
      for (let i = 0; i < 9; i++)
        beam(
          [-w * 0.37 + i * w * 0.036, -d * 0.24, h * 0.2],
          [-w * 0.3 + i * w * 0.02, -d * 0.24, h * (0.76 + 0.13 * Math.sin(i))],
          0.7,
          "ivory",
        );
      break;
    case "kaohsiung-terminal":
      loft(
        [
          [0, w, d],
          [h * 0.15, w, d],
          [h * 0.27, w * 0.9, d * 0.8],
        ],
        "silver",
        "ellipse",
        false,
      );
      loft(
        [
          [0, w * 0.2, d * 0.63, 0, w * 0.18],
          [h * 0.7, w * 0.28, d * 0.67, 18, w * 0.2],
          [h, w * 0.18, d * 0.5, 18, w * 0.19],
        ],
        "silver",
        "ellipse",
      );
      break;
    case "kaohsiung-exhibition":
      for (const y of [-d * 0.24, d * 0.24])
        loft(
          [
            [0, w, d * 0.46, 0, 0, y],
            [h * 0.4, w, d * 0.48, 0, 0, y],
            [h * 0.83, w * 0.89, d * 0.34, 0, 0, y],
            [h, w * 0.73, 1, 0, 0, y],
          ],
          "silver",
          "rectangle",
          false,
        );
      break;
    case "kaohsiung-library":
      for (const x of [-w * 0.35, w * 0.35])
        for (const y of [-d * 0.35, d * 0.35])
          beam([x, y, 0], [x, y, h], 1.5, "ivory");
      box(h * 0.17, h * 0.88, w, d);
      box(h * 0.88, h, w, d, 0, 0, "green-roof");
      break;
    case "yokohama-landmark":
      box(0, 24, w, d, 0, 0, "stone");
      loft(
        [
          [24, w * 0.68, d * 0.68],
          [h * 0.78, w * 0.59, d * 0.59],
          [h * 0.97, w * 0.53, d * 0.53],
        ],
        "stone",
      );
      for (const x of [-w * 0.24, w * 0.24])
        for (const y of [-d * 0.24, d * 0.24])
          box(h * 0.88, h, w * 0.1, d * 0.1, x, y, "stone");
      break;
    case "yokohama-queens":
      for (const p of record.parts) {
        loft(
          [
            [0, p.width, p.depth, p.rotation, p.x, p.y],
            [p.height - 8, p.width, p.depth, p.rotation, p.x, p.y],
          ],
          "glass",
        );
        loft(
          [
            [p.height - 8, p.width, p.depth, p.rotation, p.x, p.y],
            [p.height, p.width, 2, p.rotation, p.x, p.y],
          ],
          "silver",
          "rectangle",
          false,
        );
      }
      break;
    case "yokohama-sail":
      loft(
        Array.from({ length: 13 }, (_, i) => {
          const t = i / 12,
            width = Math.max(1, w * Math.sqrt(1 - t * t));
          return [h * t, width, d * (1 - 0.73 * t), 0, (w - width) / 2, 0];
        }),
        "silver",
      );
      break;
    case "yokohama-red-brick":
      for (const p of record.parts) {
        loft(
          [
            [0, p.width, p.depth, p.rotation, p.x, p.y],
            [h * 0.73, p.width, p.depth, p.rotation, p.x, p.y],
          ],
          "rose",
          "rectangle",
          false,
        );
        loft(
          [
            [h * 0.73, p.width, p.depth, p.rotation, p.x, p.y],
            [h, p.width, 1, p.rotation, p.x, p.y],
          ],
          "stone",
          "rectangle",
          false,
        );
      }
      break;
    case "space-needle":
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI * 2) / 3;
        beam(
          [22 * Math.cos(a), 22 * Math.sin(a), 0],
          [5 * Math.cos(a), 5 * Math.sin(a), 90],
          2.3,
          "ivory",
        );
        beam(
          [5 * Math.cos(a), 5 * Math.sin(a), 90],
          [15 * Math.cos(a), 15 * Math.sin(a), 151],
          2.1,
          "ivory",
        );
      }
      loft(
        [
          [145, 25, 25],
          [150, 42, 42],
          [155, 42, 42],
          [161, 26, 26],
          [164, 8, 8],
        ],
        "ivory",
        "ellipse",
      );
      spire(164);
      break;
    case "columbia-center":
      for (let i = 0; i < 3; i++)
        loft(
          [
            [0, w * 0.55, d * 0.58, 0, (i - 1) * w * 0.22, (i - 1) * d * 0.19],
            [
              h * (1 - i * 0.08),
              w * 0.55,
              d * 0.58,
              0,
              (i - 1) * w * 0.22,
              (i - 1) * d * 0.19,
            ],
          ],
          "glass",
          "ellipse",
        );
      break;
    case "smith-tower":
      setbacks([
        [h * 0.19, w, d],
        [h * 0.76, w * 0.65, d * 0.7],
        [h * 0.83, w * 0.53, d * 0.55],
      ]);
      crown(h * 0.83, h, w * 0.59, d * 0.6);
      break;
    case "rainier-tower":
      loft(
        [
          [0, w * 0.23, d * 0.3],
          [h * 0.23, w * 0.62, d * 0.67],
          [h * 0.3, w, d],
        ],
        "stone",
        "rectangle",
        false,
      );
      box(h * 0.3, h, w, d);
      break;
    case "seattle-library":
      loft(
        [
          [0, w * 0.62, d * 0.7],
          [h * 0.24, w * 0.95, d * 0.96, 0, -w * 0.03],
          [h * 0.45, w * 0.7, d * 0.63, 0, w * 0.1],
          [h * 0.73, w, d, 0, -w * 0.05],
          [h, w * 0.65, d * 0.62],
        ],
        "glass",
      );
      for (let i = 0; i < 8; i++)
        beam(
          [-w * 0.42 + i * w * 0.11, -d * 0.49, h * 0.26],
          [-w * 0.32 + i * w * 0.08, -d * 0.31, h],
          0.5,
        );
      break;
    case "mopop":
      for (let i = 0; i < 5; i++) {
        const x = ((i % 3) - 1) * w * 0.24,
          y = (i > 2 ? 1 : -1) * d * 0.18;
        loft(
          [
            [0, w * 0.41, d * 0.5, i * 23, x, y],
            [h * (0.5 + i * 0.07), w * 0.46, d * 0.52, i * 27, x, y],
            [h * (0.7 + i * 0.075), 2, 2, 0, x + 3, y],
          ],
          i % 2 ? "silver" : "rose",
          "ellipse",
          false,
        );
      }
      break;
    case "one-wtc":
      box(0, 58, w, d, 0, 0, "silver");
      loft([
        [58, w, d],
        [240, w * 0.92, d * 0.92, 22.5],
        [417, w * 0.71, d * 0.71, 45],
      ]);
      spire(417);
      break;
    case "three-wtc":
      setbacks(
        [
          [40, w, d],
          [h * 0.8, w * 0.8, d * 0.82],
          [h * 0.94, w * 0.65, d * 0.73],
          [h, w * 0.51, d * 0.61],
        ],
        "glass",
      );
      for (const x of [-w * 0.39, w * 0.39])
        for (let i = 0; i < 6; i++)
          beam(
            [x, -d * 0.4, 42 + i * h * 0.11],
            [-x, -d * 0.4, 42 + (i + 1) * h * 0.11],
            0.7,
          );
      break;
    case "four-wtc":
      box(0, h * 0.7, w, d);
      loft(
        [
          [h * 0.7, w, d],
          [h, w * 0.62, d * 0.8, 0, -w * 0.19],
        ],
        "glass",
      );
      break;
    case "30-park-place":
      setbacks([
        [h * 0.1, w, d],
        [h * 0.67, w * 0.68, d * 0.72],
        [h * 0.88, w * 0.5, d * 0.59],
        [h * 0.96, w * 0.42, d * 0.45],
        [h, w * 0.24, d * 0.3],
      ]);
      break;
    case "woolworth":
      setbacks([
        [h * 0.42, w, d],
        [h * 0.73, w * 0.43, d * 0.47],
        [h * 0.87, w * 0.32, d * 0.35],
      ]);
      crown(h * 0.87, h, w * 0.36, d * 0.4);
      for (const x of [-w * 0.2, w * 0.2])
        for (const y of [-d * 0.2, d * 0.2]) spire(h * 0.66, h * 0.81, x, y);
      break;
    case "70-pine":
      setbacks([
        [h * 0.3, w, d],
        [h * 0.64, w * 0.72, d * 0.72],
        [h * 0.79, w * 0.48, d * 0.5],
        [h * 0.91, w * 0.25, d * 0.28],
      ]);
      crown(h * 0.91, h * 0.96, w * 0.26, d * 0.3, "stone");
      spire(h * 0.95);
      break;
    case "40-wall":
      setbacks([
        [h * 0.19, w, d],
        [h * 0.7, w * 0.66, d * 0.65],
        [h * 0.84, w * 0.46, d * 0.45],
      ]);
      crown(h * 0.84, h * 0.98, w * 0.5, d * 0.49);
      spire(h * 0.96);
      break;
    case "8-spruce":
      box(0, 24, w, d, 0, 0, "stone");
      for (let i = 0; i < 7; i++)
        loft(
          Array.from({ length: 19 }, (_, j) => [
            24 + ((h - 24) * j) / 18,
            (w / 7) * 1.04,
            d * (0.7 + 0.14 * Math.sin(j * 0.8 + i)),
            0,
            ((i - 3) * w) / 7,
            d * 0.06 * Math.sin(j * 0.6 + i),
          ]),
          "silver",
        );
      break;
    case "oculus":
      loft(
        [
          [0, w, d * 0.45],
          [h * 0.4, w * 0.85, d * 0.65],
          [h * 0.7, w * 0.38, 2],
        ],
        "silver",
        "ellipse",
        false,
      );
      for (let i = 0; i < 25; i++) {
        const x = (i / 24 - 0.5) * w,
          f = Math.sin((i / 24) * Math.PI);
        for (const side of [-1, 1])
          beam(
            [x, side * d * 0.12, h * 0.25 * f],
            [x * 1.05, side * d * 0.51 * f, h * (0.45 + 0.55 * f)],
            0.65,
            "ivory",
          );
      }
      break;
    case "yokohama-marine":
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3,
          b = ((i + 1) * Math.PI) / 3;
        beam(
          [10 * Math.cos(a), 10 * Math.sin(a), 0],
          [3 * Math.cos(a), 3 * Math.sin(a), h * 0.83],
          0.7,
        );
        for (let j = 0; j < 6; j++)
          beam(
            [(10 - j) * Math.cos(a), (10 - j) * Math.sin(a), j * 13],
            [(9 - j) * Math.cos(b), (9 - j) * Math.sin(b), (j + 1) * 13],
            0.3,
          );
      }
      loft(
        [
          [h * 0.82, 13, 13],
          [h * 0.91, 13, 13],
          [h * 0.95, 7, 7],
        ],
        "silver",
        "ellipse",
      );
      spire(h * 0.95);
      break;
    case "cosmo-clock":
    case "seattle-wheel": {
      const r = h * 0.45,
        z = h - r;
      for (const y of [-4, 4]) {
        for (const x of [-r * 0.43, r * 0.43])
          beam([x, y * 2, 0], [0, y, z], 1.3, "ivory");
        for (let i = 0; i < 48; i++) {
          const a = (i * Math.PI) / 24,
            b = ((i + 1) * Math.PI) / 24;
          beam(
            [r * Math.cos(a), y, z + r * Math.sin(a)],
            [r * Math.cos(b), y, z + r * Math.sin(b)],
            0.55,
            "ivory",
          );
          if (i % 2 === 0)
            beam([0, y, z], [r * Math.cos(a), y, z + r * Math.sin(a)], 0.2);
        }
      }
      for (let i = 0; i < 24; i++) {
        const a = (i * Math.PI) / 12;
        box(
          z + r * Math.sin(a) - 2.5,
          z + r * Math.sin(a),
          3,
          5,
          r * Math.cos(a),
          0,
          "ivory",
        );
      }
      break;
    }
    case "haixin-bridge":
    case "great-harbor-bridge":
    case "brooklyn-bridge": {
      const length = record.span,
        deck = id === "brooklyn-bridge" ? 38 : 6;
      c.push({
        kind: "loft",
        shape: "polygon",
        material: "stone",
        windows: false,
        outline: record.deckOutline,
        sections: [
          [deck - 2, 2, 2, -record.rotation, 0, 0],
          [deck, 2, 2, -record.rotation, 0, 0],
        ],
      });
      if (id === "haixin-bridge") {
        const angle = (-record.rotation * Math.PI) / 180;
        const ring = record.deckOutline.map(([x, y]) => [
          x * Math.cos(angle) - y * Math.sin(angle),
          x * Math.sin(angle) + y * Math.cos(angle),
        ]);
        const xs = ring.map((p) => p[0]),
          west = Math.min(...xs) + 0.2,
          east = Math.max(...xs) - 0.2;
        // Follow the curved mapped deck instead of stretching a straight arch
        // over empty water. Slice the deck at each station to find its centre.
        const station = (t) => {
          const x = west + (east - west) * t,
            intersections = [];
          for (let j = 0; j < ring.length; j++) {
            const a = ring[j],
              b = ring[(j + 1) % ring.length];
            if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x))
              intersections.push(
                a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]),
              );
          }
          intersections.sort((a, b) => a - b);
          let y = 0,
            widest = -1;
          for (let j = 0; j + 1 < intersections.length; j += 2)
            if (intersections[j + 1] - intersections[j] > widest) {
              widest = intersections[j + 1] - intersections[j];
              y = (intersections[j + 1] + intersections[j]) / 2;
            }
          return [x, y, deck + (h - deck) * Math.sin(t * Math.PI)];
        };
        for (let i = 0; i < 32; i++) {
          const p = station(i / 32),
            next = station((i + 1) / 32);
          beam(p, next, 1.1, "ivory");
          if (i > 0 && i % 2 === 0) beam(p, [p[0], p[1], deck], 0.18);
        }
      } else if (id === "great-harbor-bridge") {
        for (const y of [-5, 5])
          beam([0, y, deck], [length * 0.07, 0, h], 1.5, "ivory");
        for (let i = -5; i <= 5; i++)
          if (i)
            beam(
              [length * 0.07, 0, h],
              [(i * length) / 11, 0, deck],
              0.18,
              "ivory",
            );
      } else {
        for (const x of [-243, 243]) {
          for (const y of [-11, 11]) box(0, h, 18, 7, x, y, "stone");
          box(h * 0.8, h, 18, 28, x, 0, "stone");
        }
        for (const y of [-11, 11])
          for (const [a, b, sag] of [
            [-length / 2, -243, 8],
            [-243, 243, h - deck - 7],
            [243, length / 2, 8],
          ]) {
            const curve = (t) => {
              const start = Math.abs(a) === 243 ? h : deck + 2;
              const end = Math.abs(b) === 243 ? h : deck + 2;
              return start * (1 - t) + end * t - sag * 4 * t * (1 - t);
            };
            for (let i = 0; i < 24; i++) {
              const x = a + ((b - a) * i) / 24,
                nx = a + ((b - a) * (i + 1)) / 24;
              beam(
                [x, y, curve(i / 24)],
                [nx, y, curve((i + 1) / 24)],
                0.4,
                "ivory",
              );
              if (i % 2 === 0)
                beam([x, y, Math.max(deck, curve(i / 24))], [x, y, deck], 0.14);
            }
          }
      }
      break;
    }
    default:
      throw Error(`Missing showcase silhouette: ${id}`);
  }
  const cool = [
    "nan-shan",
    "guangzhou-ifc",
    "guangzhou-ctf",
    "kaohsiung-85",
    "yokohama-queens",
    "columbia-center",
    "rainier-tower",
    "one-wtc",
    "three-wtc",
    "four-wtc",
    "8-spruce",
  ];
  return {
    ...record,
    lighting: cool.includes(id) ? 2 : 1,
    generator: "components",
    art: { rotation: record.parts ? 0 : record.rotation || 0 },
    components: c,
  };
}
