# Releasing

1. Set the version in package.json and package-lock.json, and write concise notes in docs/releases/.
2. Run [Testing](TESTING.md), including browser exports and both interface languages.
3. Refresh public artwork when the visible renderer changes. Check credits and media hashes.
4. Run npm run pack:release to create versioned site/source archives and SHA-256 files under artifacts/releases/.
5. Extract the site archive into a clean directory and smoke-test npm start. Check the homepage, building service, source download and exports. Build the source archive independently.
6. Commit the reviewed source and publish the matching tag and notes. Attach both archives and their checksums.

The site archive contains the compiled website, bundled Node backend, Python worker sources and deployment instructions. Node.js 24 and Python 3.12 are host prerequisites. The source archive includes code, tests, documentation and build inputs; local notes, credentials, caches and repository history are excluded.

Deploy the matching source archive with the website. Keep the previous release and persistent caches for rollback. See [Hosting](HOSTING.md).
