# ci

Reusable GitHub Actions workflows for dvd117 project repositories. Call them by
tag so project workflows can stay small while this repository owns the shared
verification and deployment behavior.

## Workflows

### `node-verify.yml`

Checks out a Node.js project, installs its locked dependencies with `npm ci`,
runs its tests and build, then fails on an npm advisory at or above the selected
severity. The caller should set `node-version` to the version used by its
Dockerfile base image.

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `node-version` | yes | none | Node.js version to install. |
| `test-command` | no | `npm test` | Test command. |
| `build-command` | no | `npm run build` | Build command. |
| `audit-level` | no | `moderate` | Minimum npm audit severity that fails the job. |
| `working-directory` | no | `.` | Directory containing the Node.js project. |

### `image-smoke.yml`

Builds the repository Dockerfile with Buildx, loads the image locally without
pushing it, starts the image, and waits for its own `HEALTHCHECK`. An image
without a healthcheck fails with an explicit error. When the timeout expires,
the workflow prints container logs before failing.

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `port` | no | `3000` | Value passed as `PORT` to the container. |
| `docker-run-args` | no | empty | Extra `docker run` flags, such as `-e KEY=VALUE`. |
| `timeout-seconds` | no | `30` | Seconds to wait for a healthy container. |

The image must provide a Dockerfile and an internal healthcheck endpoint. Keep
healthcheck dependencies local to the container. The workflow uses the image's
own healthcheck rather than assuming that a successful build proves the command
will boot.

### `ship.yml`

Fast-forwards a deployment branch to the calling commit after the caller's
verification jobs have passed. It defaults to `production` and fails instead of
overwriting a deployment branch that has moved independently.

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `branch` | no | `production` | Branch to advance to `github.sha`. |

The caller must grant `contents: write` on the job that calls this workflow.
The called workflow also requests that permission at its job level, but GitHub
does not allow a called workflow to elevate permissions withheld by its caller.

### `python-verify.yml`

Installs Python with `astral-sh/setup-uv`, syncs project dependencies, runs Ruff,
and runs pytest. If a project declares a `dev` dependency group, it uses
`uv sync --all-extras --dev`; otherwise it uses `uv sync`. Pytest exit code 5
for no collected tests remains a failure, so every project must include at least
one test.

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `python-version` | no | `3.12` | Python version to install. |
| `working-directory` | no | `.` | Directory containing the Python project. |

## Example callers

The complete caller files are also available at
[`examples/node-deployable.yml`](examples/node-deployable.yml) and
[`examples/python-local.yml`](examples/python-local.yml).

### Deployable Node project

This caller runs verify, then image smoke, then ship. Ship runs only for a push
to `main`, not for pull requests or the weekly schedule. The weekly schedule is
included so npm audits run on days nobody commits and a new advisory is not
waiting for unrelated code changes.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  # A new advisory lands on a day nobody commits. Without this, npm audit only
  # runs when something else happens to change.
  schedule:
    - cron: "0 6 * * 1"

permissions:
  contents: read

jobs:
  verify:
    uses: dvd117/ci/.github/workflows/node-verify.yml@v1
    with:
      node-version: "22"

  image:
    needs: verify
    uses: dvd117/ci/.github/workflows/image-smoke.yml@v1
    with:
      port: "3000"

  ship:
    needs: [verify, image]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    permissions:
      contents: write
    uses: dvd117/ci/.github/workflows/ship.yml@v1
    with:
      branch: production
```

### Local Python project

This caller runs only the Python verification workflow.

```yaml
name: Python verify

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    uses: dvd117/ci/.github/workflows/python-verify.yml@v1
    with:
      python-version: "3.12"
```
