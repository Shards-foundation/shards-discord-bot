# CI Workflow Audit — Shards Discord Bot

Date: 16 November 2026

## Verified repository scope

This repository is a **Node.js 24.17+ Discord bot**, using discord.js,
Ollama/Qwen integration, Node's built-in test runner, Docker and Compose.
At audit time the default-branch tree contains no Python source,
`pyproject.toml`, `requirements.txt`, Android Gradle project,
Xcode workspace, Next.js app, Terraform plan or webpack build script.

The main source-of-truth checks are `.github/workflows/ci.yml` and
`.github/workflows/container.yml`.
The CI workflow runs syntax checks, Node tests and a production
dependency audit. The container workflow validates Compose and builds
the container without deploying it.

## Legacy workflow cleanup proposed

The following starter workflows have been **removed in this PR only**.
They were configured to run automatically but cannot meaningfully
test this repository in its present form:

| Removed workflow | Reason |
|---|---|
| `android.yml` | No Gradle project or `gradlew` |
| `ios.yml` | No Xcode project, workspace or Swift package |
| `python-app.yml` | No Python application or pytest tests |
| `pylint.yml` | Matrix contained obsolete 3.8 and 3.9; no Python files |
| `pysa.yml` | No Python code, unsupported old upload-artifact dependency |
| `python-publish.yml` | No Python distributions; accidental PyPI release trigger |
| `nextjs.yml` | No Next.js site; automated Pages deployment was unrelated |
| `webpack.yml` | No webpack configuration/build; obsolete Node 18/20 matrix |
| `node.js.yml` | Duplicate Node matrix incompatible with Node >=24.17 engine |
| `datadog-synthetics.yml` | No configured synthetic tests/API keys; avoid paid services |
| `policy-validator-tf.yml` | No Terraform plan; placeholder AWS region and role |
| `label.yml` | No `.github/labeler.yml`; placeholder PR-target labeller |
| `docker-image.yml` | Duplicate Docker build already covered by `container.yml` |
| `codeql.yml` | Advanced CodeQL conflicts with configured GitHub default setup |

Removing an unrelated scanner does not imply weakening the project's
applicable security checks. Node dependency auditing, GitHub CodeQL
default setup, Codacy, OSV, dependency review and container analysis
remain in scope. The old Pysa scanner examined Python, not this bot.

## Kept and strengthened

- `ci.yml`: Node 24.17.0 syntax/test/`npm audit` gate,
  read-only GitHub token, immutable Actions pins and no install scripts.
- `container.yml`: actual Docker/Compose validation.
- `super-linter.yml`: changed-file formatting checks.
- `codacy.yml`: static/security inspection.
- `osv-scanner.yml`: pinned OSV Scanner Action **v2.7.0**, PR regression
  scanning and scheduled scanning retained.
- `dependency-review.yml`: dependency change review.
- `hadolint.yml`, `devskim.yml`, `ossar.yml`,
  `defender-for-devops.yml`: existing applicable security layers
  retained; further updates require their own verified review.
- `deploy-self-hosted.yml`: deployment trigger now includes a narrow
  `paths` allowlist for `src/**`, `scripts/**`, `package.json`,
  `package-lock.json`, `compose.yaml`, `Dockerfile` and `.dockerignore`.
  CI, tests, documentation and Activity-only edits no longer qualify
  for automatic self-hosted deployment. The job body and runner labels
  are otherwise unchanged.
- Other unrelated but potentially useful notification/publication
  automations are left unchanged pending separate owner review.

### OSV migration details

The prior `google/osv-scanner-action` reference was v1.7.1 and invoked
`--skip-git`. **OSV Scanner v2 removed this flag**, so blindly updating
the version without removing it would create a broken scan.
The action is now pinned to the exact v2.7.0 commit and retains
failure-on-new-vulnerability behaviour. The existing `-r ./` scope is
preserved. A live OSV scan in CI must verify this integration.

## Python version policy

Python is not required to build or test this bot. There is **no Python
matrix to upgrade** in this repository after removing irrelevant jobs.

If genuine Python components are added later, create scoped workflows
for those components and choose a supported compatibility matrix
based on their declared `requires-python` and dependency support.

On 16 November 2026:

- Python **3.15.2** is the latest stable patch release.
- Python **3.16.0a2** is an experimental alpha, not production.
- Python 3.9 and 3.10 have reached end of life.
- Python 3.14 remains a suitable additional compatibility target.

Release sources:
[Python releases](https://www.python.org/doc/versions/) and
[Python version status](https://devguide.python.org/versions/).

## Merge and operational gates

**Do not merge this PR until the following are checked.**

- Confirm required GitHub branch-protection checks and rulesets.
  Connected API access returned 403 for branch protection, so the
  current required-check list is not proven. Removing old workflow
  files can leave retired required status contexts that block merges.
- Confirm GitHub's **CodeQL default setup** still runs JavaScript
  and Actions analysis. GitHub rejects advanced CodeQL SARIF uploads
  while default setup is enabled. Do not disable default security.
- Confirm `osv-scanner.yml` and all applicable security workflows
  actually execute and report results; do not mark them green if they
  fail due to configuration.
- Confirm self-hosted runner ownership before any merge that changes
  runtime allowlisted paths. GitHub `push.paths` will skip
  `deploy-self-hosted.yml` for the CI-only changes in this PR,
  provided the merge does not include unrelated runtime files.
  PR #23 separately changes `src/` and `package.json` and is **not**
  covered by this safety exemption.
- Review whether the existing `docker-publish.yml` daily publication,
  `npm-publish-github-packages.yml`, issue AI summaries and stale
  PR automation are still desired. They were **not changed** here.
- Preserve the independent Entry Point repair in PR #23 and
  all existing Discord commands. This PR contains **no** Discord
  registration or credentials operations.

## Evidence and acceptance

This PR is a proposed CI topology cleanup, not a production
deployment. Its check results are evidence for the new workflow
configuration only. Changes must remain in a draft until review
and a deliberate, authorised merge after the runtime/deploy gate.
