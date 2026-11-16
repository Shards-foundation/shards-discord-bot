import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const pathOf = path => new URL(path, root)
const read = path => readFileSync(pathOf(path), 'utf8')

const retired = [
  'android.yml', 'ios.yml', 'python-app.yml', 'pylint.yml',
  'pysa.yml', 'python-publish.yml', 'nextjs.yml', 'webpack.yml',
  'node.js.yml', 'datadog-synthetics.yml', 'policy-validator-tf.yml',
  'label.yml', 'docker-image.yml', 'codeql.yml'
]
const required = [
  'ci.yml', 'container.yml', 'super-linter.yml', 'codacy.yml',
  'osv-scanner.yml', 'dependency-review.yml', 'hadolint.yml',
  'devskim.yml', 'deploy-self-hosted.yml'
]

test('irrelevant starter workflows are absent from the Node.js bot', () => {
  for (const name of retired) {
    assert.equal(existsSync(pathOf('.github/workflows/' + name)), false, name)
  }
})

test('required Node and security workflows remain installed', () => {
  for (const name of required) {
    assert.equal(existsSync(pathOf('.github/workflows/' + name)), true, name)
  }
})

test('Node CI keeps deterministic execution and high-severity audit', () => {
  const ci = read('.github/workflows/ci.yml')
  assert.match(ci, /node-version: '24\.17\.0'/)
  assert.match(ci, /npm ci --ignore-scripts --no-audit --no-fund/)
  assert.match(ci, /npm audit --omit=dev --audit-level=high/)
  assert.match(ci, /persist-credentials: false/)
  assert.match(ci, /permissions:\s*\n\s*contents: read/)
})

test('OSV security scanning uses pinned v2 and no removed v1 flag', () => {
  const osv = read('.github/workflows/osv-scanner.yml')
  assert.equal(osv.includes('--skip-git'), false)
  assert.equal(osv.includes('osv-scanner-reusable-pr.yml@b1d267aea5211fa648d9d442fa64b90dbdcbdd36'), true)
  assert.equal(osv.includes('osv-scanner-reusable.yml@b1d267aea5211fa648d9d442fa64b90dbdcbdd36'), true)
  assert.match(osv, /security-events: write/)
  assert.match(osv, /scan-pr:/)
  assert.match(osv, /scan-scheduled:/)
})

test('production deploy is only a push-to-main workflow, not a PR or manual trigger', () => {
  const deploy = read('.github/workflows/deploy-self-hosted.yml')
  assert.match(deploy, /push:\s*\n\s*branches:\s*\n\s*- main/)
  assert.match(deploy, /runs-on: \[self-hosted, linux, x64, shards-deploy\]/)
  assert.equal(deploy.includes('pull_request:'), false)
  assert.equal(deploy.includes('workflow_dispatch:'), false)
  assert.equal(deploy.includes('shards-discord-bot'), true)
})

test('CI audit documents default CodeQL and protects Discord bot commands', () => {
  const audit = read('CI_WORKFLOW_AUDIT.md')
  assert.match(audit, /CodeQL default setup/)
  assert.match(audit, /Discord commands/)
  assert.equal(existsSync(pathOf('.github/workflows/codeql.yml')), false)
})
