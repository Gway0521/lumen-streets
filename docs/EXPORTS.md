# Wallpapers and animations

Open **Capture**, choose a format and ratio, then drag the live map to compose. **Compose full screen** hides the controls while framing. Export completion, failure and cancellation restore the editor's traffic, time, playback, resolution and interactions.

| Format | Longest edge | Duration |
| --- | --- | --- |
| PNG | 1920, 2560 or 3840 px | Still |
| Video | 1920 or 2560 px | 30, 60, 120, 180 or 300 seconds; 30 fps |
| GIF | 720 px | Six seconds; 10 fps |

Video chooses MP4/AVC when encoding is supported at the requested dimensions, then tries WebM/VP9. Video dimensions are rounded to even pixels. Videos are silent and repeat with a cut.

Ratios include current view, screen, 16:9, 16:10, ultrawide, square, tablet, phone and custom values between 1:4 and 4:1. The selected resolution is the longest edge, not the vertical pixel count: 2560 at 16:9 produces 2560×1440; 1920 at 9:20 produces 864×1920. The live preview shows the framing.

## Text and shading

Wallpaper options share adjustable edge shading, brightness and area across all formats. Place titles support editable text, four corners and three sizes; landmark labels are optional. Fonts load from bundled Cormorant Garamond and Noto Serif TC files. Text and shading are off by default and are saved in [scene files](SCENES.md).

The current capture interface has no on-image source-credit switch or detached credit download. When publishing an export, provide visible map credit and the [OpenStreetMap license link](https://www.openstreetmap.org/copyright) alongside it; see [Attribution](../ATTRIBUTION.md).

## Export recovery

Try PNG or a smaller size if video encoding is unavailable. Longer or larger videos require browser temporary-file storage. Encoded output is capped at 1.5 GB, with a 250 MB in-memory fallback. Keep the page open during capture; Cancel restores the view. Temporary downloads are released after a short delay or when the page closes.

The old 2D editor's study PNG, manual MP4/WebM selection and 15-second/custom-duration controls are not part of the 3D interface. See [wallpaper setup](../public/wallpapers.html) and [compatibility](COMPATIBILITY.md).
