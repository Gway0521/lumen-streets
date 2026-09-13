# Wallpapers and animations

Open **Export**, choose a format and frame the scene. Drag, zoom or use the arrow keys in the crop preview. Exporting preserves the editor's view and playback.

## Formats

| Format | Size | Duration |
| --- | --- | --- |
| PNG | Screen ratio, 3840×2160 desktop, 3840×2400 wide desktop, or 1080×1920 portrait | Still image |
| MP4 / H.264 | 1080p or 1440p | 15–300 seconds, 30 fps |
| WebM / VP9 | Same sizes as MP4 | 15–300 seconds, 30 fps |
| GIF | 720 px long edge | Six seconds, 15 fps |
| Study PNG, in the information panel | 1600×1600, full mapped area | Still image for rendering comparisons |

Desktop video sizes are 1920×1080 or 2560×1440. The 16:10 option uses 1920×1200 or 2560×1600; portrait reverses the 16:9 dimensions. Screen ratio uses a 1920 or 2560 px long edge.

**Screen ratio** uses the full display dimensions reported by the browser, including the area occupied by browser and system bars. Resizing the browser window does not change that ratio. Rotating the device while the export dialog is open updates its preview. For example, a portrait 20:9 display produces 864×1920 video, and a landscape 16:10 display produces 1920×1200. PNG uses the reported screen size and pixel density, up to a 3840 px long edge. Browser privacy restrictions and CSS-pixel rounding can limit the accuracy of reported dimensions; video dimensions are rounded to even pixels. If screen dimensions are unavailable, the current canvas dimensions are used.

MP4 is a useful first choice for video-wallpaper players; WebM is an alternative where supported. Videos are silent and restart with a cut. GIF is a small sharing preview.

## Framing and text

The crop fills the selected ratio while keeping streets in proportion and staying within the mapped area. Water and parks remain part of the composition.

**Room for icons** darkens the left, right, top or bottom edge by an adjustable amount. Position the streets in the clearer part of the crop. This setting applies to the exported image or animation.

Optional place titles have editable text, four corner positions and three sizes. Landmark names are a separate option. Titles use locally hosted Cormorant Garamond and Noto Serif TC; if a font fails to load, retry or turn the title off.

Text, edge dimming and source credit start off. Export framing and titles are separate from [saved scenes](SCENES.md).

## Sharing your work

For public sharing, include readable OpenStreetMap attribution and a license link in or alongside the work, as appropriate to the medium. Enable source credit in the export dialog when the file needs to carry its own credit. A detached credits file or hidden metadata alone may not satisfy public attribution requirements. See [Attribution](../ATTRIBUTION.md).

## If an export fails

- **Format unavailable:** the browser checks the selected codec and dimensions. Try another format, a smaller size, or a current desktop Chrome or Edge.
- **Not enough storage:** shorten the clip or choose 1080p. Five-minute 1440p files can approach 1 GB, and private browsing may provide less temporary storage.
- **Long export unavailable:** clips above 60 seconds or a 1920 px long edge need browser temporary-file storage. The memory fallback is limited to smaller clips.
- **Slow rendering:** dense maps and large frames take more work. Keep the export page open; cancel the job if you want to change its settings.

Video files are limited to 1.5 GB, or 250 MB with the memory fallback. Closing the result releases its temporary file. After a browser crash, clearing this site's storage can remove leftover temporary exports.

To apply a wallpaper, save the file and use your operating system's wallpaper settings or a compatible video-wallpaper player. See the [Windows, Android and iPhone guide](../public/wallpapers.html) and [browser compatibility](COMPATIBILITY.md).

Implementation details are in [Architecture](ARCHITECTURE.md); software and font licenses are in [Attribution](../ATTRIBUTION.md).
