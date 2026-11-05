# Contributing

Short version: keep it small, keep it honest, keep it local.

- **Scope.** toolwatch detects changes in the dev-tool trust surface. It does
  not sandbox, block, or judge tools. A feature that needs network access,
  a model, or an account does not belong here.
- **Tests.** Every new collector or parser ships with unit tests on recorded
  fixtures. Run `npm test` and `npm run test:live` before opening a PR.
- **No live network in tests.** Unit and e2e tests run against fixtures under
  `fixtures/`. The live smoke test only reads the local machine.
- **English only.** All public content (README, docs, code strings, comments)
  is English. Run `node scripts/preflight.js` before pushing.
- **No fake evidence.** Demo transcripts and replay fixtures are generated
  from real runs or labelled reconstructions with provenance. Never hand-edit
  a transcript to make a demo look better.
- **Privacy.** Collectors must never copy file contents that can hold secrets
  (shell startup files are hashed, endpoints are host-only). If a new
  collector needs a new field, say in the PR why it cannot leak a secret.
