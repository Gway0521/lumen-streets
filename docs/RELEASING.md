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

## Version and assets

Set the version in `package.json` and the root entries of `package-lock.json`. Write concise notes in `docs/releases/vX.Y.Z.md`, covering visible changes, upgrade behaviour and known limits. Keep old release notes as a version history.

For v0.2.0, use [releases/v0.2.0.md](releases/v0.2.0.md). After the checks above, run:

```sh
npm run pack:release
```

This rebuilds the site, checks the distribution and creates these files under `artifacts/releases/v0.2.0/`:

- `lumen-streets-v0.2.0-site.tar.gz` and its `.sha256` file
- `lumen-streets-v0.2.0-source.tar.gz` and its `.sha256` file

Verify the checksums and extract both archives. The site package must start with Node.js 24; the source package must install and build independently. Packaging removes its temporary site directory on success and failure.

Commit the reviewed source and tag that exact commit as `v0.2.0`. Create a GitHub draft with the notes and four files, check the tag target and downloads, then publish. Versioned links resolve after the tag is published. Deploy the same site archive separately and verify the public editor, player and source download.
