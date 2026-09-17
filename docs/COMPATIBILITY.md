# Browser compatibility

The main editor requires WebGL2 and online vector tiles. Use a current desktop browser with WebCodecs for video export; encoding support is checked for the requested dimensions. PNG and GIF do not require a video encoder.

CI runs the core browser suite with Chromium. Local runs can use Chromium or installed Microsoft Edge; the live-provider 3D scripts use Edge. Checks include desktop and mobile viewports, real exports and scene restoration; the live suites also exercise model imports. Commands are in [Testing](TESTING.md).

Mobile emulation uses the host GPU and does not establish physical-phone performance. Physical Android, iPhone/Safari and sustained long-video coverage remain open.

## Known limits

- Preset scenes also need online tiles. A network failure offers Retry; fully offline 3D ground maps are not implemented.
- Dense or wide views can reach geometry and tile budgets. Distant buildings use simplified volumes; the outer coverage limit is reported.
- Exports temporarily increase GPU surface sizes. Lower the resolution if the device cannot sustain them.
- Video encoding and temporary-file storage depend on browser support and a secure context.
- Videos restart with a cut. Native wallpaper installation and Live Photo conversion are not included.
- Global trains and persistent traffic across snapshot/tile seams are not implemented.
- Imported GLBs remain local and are separate from shared scenes.

See [Exports](EXPORTS.md), [Testing](TESTING.md) and [3D resource budgets](ARCHITECTURE.md).
