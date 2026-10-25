# Contributing

Thanks for your interest in Trimly! Bug reports, ideas and pull requests are all welcome.

## Reporting bugs and requesting features

Open an [issue](https://github.com/is-cout/trimly-obsidian/issues). For bugs, include:

- Plugin version, Obsidian version, and platform (Windows / macOS / Linux / iPadOS / Android).
- Steps to reproduce, what you expected, and what happened.
- Any errors from the developer console (Ctrl+Shift+I / Cmd+Option+I).

## Pull requests

1. Branch off `develop` (not `main`): `feature/<name>` for new functionality, `fix/<name>` for bug fixes, `chore/<name>` for tooling/docs.
2. Set up and build the plugin as described in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
3. Before opening the PR, make sure `npm test` and `npm run build` pass, and test the change in a real vault.
   Never add a code path that writes plaintext to the vault: all writes go through `src/store.ts` (see the encryption rule in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)); `npm test` enforces it.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (`feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`), and keep commits small and focused.
5. Update the docs your change affects and add an entry to [docs/CHANGELOG.md](docs/CHANGELOG.md).
6. Open the PR against `develop`.

Dependencies are pinned to exact versions. Please don't add, remove or bump a dependency without discussing it in an issue first — see [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).

## License

By contributing, you agree that your contributions are licensed under the project's [GPL-3.0 license](LICENSE).
