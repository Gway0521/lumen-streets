# Browser compatibility

Start with a current desktop Chrome or Edge for video export. The app enables MP4 and WebM only when the browser can encode the selected format and size. PNG remains available without video encoding.

| Environment | Checked functionality | Limits |
| --- | --- | --- |
| Windows Edge 153 | Eight maps, both languages, PNG/GIF/MP4/WebM, scene files and player | Dense imports can briefly pause the interface |
| Windows WebKit 26.5 test build | Artwork, labels, PNG/GIF and narrow layouts | Physical iPhone/Safari support remains unverified |
| Android | v0.2.0 checked on a physical device | Long 1440p exports have not been separately verified |
| Other browsers and phones | Runtime format detection | Device coverage is still limited |

## Known limits

- Large maps can briefly block drawing while geometry and lighting are prepared.
- Aerial Gold caches an additional structure layer for building occlusion. Dense scenes and exports use more memory than the flat palettes; physical iPhone validation of v0.2.0 is pending.
- Static atlases use software rasterization to avoid an Android GPU failure during map construction. A browser already left with a black page by an older build may need to be fully restarted once before opening the updated build.
- Video export needs a secure browser context: use HTTPS for hosted sites.
- Longer video exports need browser temporary-file storage. A five-minute 1440p file can approach 1 GB; shorter 1080p clips need less space.
- Videos restart with a cut, rather than a seamless loop.
- Video wallpapers need a compatible player. iPhone Live Photo conversion is not included.
- Traffic is an artistic simulation; crowded junctions can form queues.

See [Exports](EXPORTS.md) for formats and troubleshooting, and [Testing](TESTING.md) for reproducible browser checks.
