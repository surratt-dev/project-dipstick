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
