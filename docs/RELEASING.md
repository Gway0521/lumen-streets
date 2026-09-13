# Publishing

## Check the candidate

```sh
npm ci
npm test
npm run check:presets
npm run build
npm run check:release
```

Review the app in both languages on desktop and a narrow touch viewport. Download an image, a video and a scene file; reopen the scene and inspect the video's end. Use [Testing](TESTING.md) for the repeatable suites and [Compatibility](COMPATIBILITY.md) for known limits.

## Repository

- Confirm the AGPL source download matches the deployed version and opens from both editor and player.
- Check staged files, author metadata, licenses and asset provenance. Keep private notes, credentials, caches and test output out of Git.
- Keep the README image and gallery consistent with the current renderer. Include visible OpenStreetMap attribution beside public artwork.
- Set the repository description to “Turn real streets into living nightscapes.” Useful topics include `generative-art`, `maps`, `openstreetmap`, `wallpaper`, `canvas` and `creative-coding`.
- Use `docs/images/social-left.jpg` for the repository social preview and [the public demo](https://lumenstreets.feifeihome.com/) for the repository website field. Keep both README links current.

## Website

See [Hosting](HOSTING.md) for a deployable archive and server settings. The Node deployment serves the website and API at one HTTPS origin. Static-only builds also support a repository subpath. Verify the deployed editor, gallery, fonts, player links and downloads; keep HTML cache lifetimes short during updates.

Use `npm start` for the production website and search server. Verify a real search, selected-area import, cache hit and provider-error recovery. Keep the Vite development gateway private. See [Providers](PROVIDERS.md) for limits and upstream capacity.

Release notes should describe visible changes and known limits. Browser viewport tests are not physical-device tests; advertise support only where it has been checked.
