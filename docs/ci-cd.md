# CI/CD & Release Process

## GitHub Actions Workflows

### CI (`ci.yml`)

Runs on every push to `main` and on pull requests targeting `main`. Three parallel jobs:

| Job | What it does |
|---|---|
| **Lint** | Runs ESLint across all packages |
| **Type Check** | Full `npm run build` (shared → backend → frontend) to catch type errors |
| **Unit Tests** | Builds the shared package, then runs Vitest across backend and frontend |

All jobs use Node.js 22 with npm caching. Concurrent runs on the same branch are cancelled automatically.

### Integration Tests (`integration.yml`)

Runs on the same triggers as CI. Spins up Postgres 16 and Redis 7 as GitHub Actions service containers (matching the local Docker Compose configuration), applies database migrations, and runs the full test suite against real services.

### Docker Build (`docker.yml`)

Runs on pushes to `main`, version tags (`v*`), and pull requests:

- **Pull requests** — builds the image only (validates the Dockerfile).
- **Pushes to `main`** — builds and pushes to GitHub Container Registry (`ghcr.io`).
- **Version tags** — builds and pushes with semver tags (e.g., `1.0.0`, `1.0`), plus a commit SHA tag.

Uses BuildKit with GitHub Actions cache for fast layer reuse.

### Release (`release.yml`)

Triggered exclusively by version tags (`v*`). Creates a GitHub Release with auto-generated release notes covering all commits since the previous tag.

## README Badges

The README shows GitHub Actions status badges for every workflow, the latest release, the Node version, the stack, and line coverage for the backend and frontend packages. The shared package has no coverage badge: it contains only types, so there is no runtime code to measure.

Coverage badges are self-hosted: on each push to `main`, the CI **Unit Tests** job reads `packages/{backend,frontend}/coverage/coverage-summary.json` (vitest `json-summary` reporter) and writes a [shields.io endpoint](https://shields.io/badges/endpoint-badge) JSON file per package to a gist via [`schneegans/dynamic-badges-action`](https://github.com/schneegans/dynamic-badges-action). The badges go red at 50% and green at 100%.

### One-time setup

1. Create a **public** gist at <https://gist.github.com> containing any placeholder file (e.g. `dipstick-coverage-backend.json` with `{}`). Note the gist ID (the hash in its URL) and the owning account.
2. Create a personal access token with only the **`gist`** scope (classic), and add it as the repository secret **`GIST_TOKEN`** (Settings → Secrets and variables → Actions → Secrets).
3. Add the gist ID as the repository variable **`COVERAGE_GIST_ID`** (same page → Variables).
4. In `README.md`, replace `GIST_OWNER/GIST_ID` in the two coverage badge URLs with the gist owner and ID.

Until `COVERAGE_GIST_ID` is set, the publish steps are skipped, so CI stays green. The badges read "resource not found" until the first push to `main` after setup creates the gist files. shields.io and the raw gist URL cache responses for about 5 minutes, so a badge can stay on that message for a few minutes after the files appear.

## Release Process

Releases are cut by pushing a semver git tag. No package.json version bumps are required.

### Cutting a release

```bash
git tag v1.0.0
git push origin v1.0.0
```

This triggers two workflows in parallel:

1. **Release** — creates a GitHub Release with a changelog generated from commit history.
2. **Docker Build** — builds and pushes a container image tagged `1.0.0`, `1.0`, and the commit SHA to `ghcr.io`.

### Versioning convention

Tags follow [Semantic Versioning](https://semver.org/):

- **Major** (`v2.0.0`) — breaking changes to the API or database schema requiring migration coordination.
- **Minor** (`v1.1.0`) — new features, backward-compatible changes.
- **Patch** (`v1.0.1`) — bug fixes, dependency updates, documentation changes.

### Viewing releases

All releases and their changelogs are available on the GitHub Releases page for the repository.
