# Release Process

Releases are created from version tags and built by GitHub Actions.

## Release A Version

1. Update the version in `package.json` and `src-tauri/tauri.conf.json`.
2. Commit the release changes.
3. Create and push an annotated tag:

```bash
git tag -a v1.0.1 -m "Release v1.0.1"
git push origin v1.0.1
```

The `Release` workflow then:

- Installs Tauri's Linux build dependencies.
- Runs `npm ci` and `npm run tauri:build`.
- Builds `.deb` and `.rpm` packages.
- Groups commit subjects into Features, Fixes, Performance, Documentation, and Other Changes.
- Publishes the packages and generated `release-notes.md` to the GitHub release.

## Commit Format

Use conventional prefixes so release notes stay organized:

```text
feat: add a new capability
fix: correct a broken workflow
perf: reduce startup time
docs: update the release process
```

Optional scopes and breaking changes are supported, for example:

```text
feat(ide): add folder import
fix!: change the native API contract
```

Unprefixed commits are placed under `Other`.

## Local Verification

Run the same core checks before tagging:

```bash
npm ci
npm run tauri:build
```

To preview the generated notes:

```bash
npm run release:notes
cat release-notes.md
```

`release-notes.md` is generated output and should not be committed.
