#!/usr/bin/env node
// Black-box contract tests against ACTUAL setup-generated scripts, never a mock core.
// Usage: node generated-core-regression.mjs <scratch-fixture.json>
// Descriptor: {scratch:true, repo, runner, init, teardown, unique_keys,
//   controls:{delay:{ENV:'1000'}, partial_failure:{ENV:'1'}}, secret_markers:[...]}
// Paths init/teardown are repo-relative. The local fake hooks implement controls and
// expose unique_keys in success.resources. No cloud, downloads, or real services.
// The fixture must use local .worktrees, same-name branches, an ignored .env copied
// read-only, .env.worktree managing PORT, and at least four free fake resource slots.
// For delay testing set lock_wait_seconds <= 1 and make the hook delay at least 2s.
// Worktrees/branches/logs are retained for inspection; run only in a disposable repo.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'

const descriptor = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
assert.equal(descriptor.scratch, true, 'an explicit disposable-fixture descriptor is required')
const repo = path.resolve(descriptor.repo)
const configPath = path.join(repo, 'docs/worktree.config.json')
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'))
const config = read(configPath)
assert.equal(config.storage.mode, 'local')
assert.equal(config.storage.root, '.worktrees')
assert.equal(config.env.file, '.env.worktree')
assert.ok(config.env.managed_keys.includes('PORT'))
const runner = descriptor.runner || config.scripts.runner
const git = (...args) => {
  const r = spawnSync('git', ['-c', 'core.hooksPath=', '-C', repo, ...args], { encoding: 'utf8' })
  assert.ifError(r.error)
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}
const stateDir = path.resolve(repo, git('rev-parse', '--git-common-dir'), config.state_dir)
const prefix = 'reg-' + randomUUID().slice(0, 8)
const names = ['one', 'two', 'three', 'partial'].map(suffix => prefix + '-' + suffix)
const worktree = name => path.join(repo, '.worktrees', name)
const manifest = name => path.join(stateDir, name + '.copied.json')
function write(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value))
}
function snapshot(dir) {
  const result = []
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const p = path.join(current, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.isSymbolicLink()) result.push([path.relative(dir, p), fs.readlinkSync(p)])
      else result.push([path.relative(dir, p), createHash('sha256').update(fs.readFileSync(p)).digest('hex')])
    }
  }
  walk(dir)
  return result.sort(([a], [b]) => a.localeCompare(b))
}
async function call(kind, name, extra = [], controls = {}) {
  const script = path.resolve(repo, descriptor[kind])
  const argv = [script, '--repo', repo, '--worktree', worktree(name), '--name', name,
    '--config', configPath, '--copied-manifest', manifest(name), '--json', ...extra]
  return new Promise((resolve, reject) => {
    const child = spawn(runner, argv, { cwd: repo, env: { ...process.env, ...controls } })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => { child.kill(); reject(new Error('fixture command timed out')) }, 30_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => {
      clearTimeout(timer)
      try { resolve({ code, data: JSON.parse(stdout.trim().split(/\r?\n/).at(-1)), stdout, stderr }) }
      catch { reject(new Error('missing final JSON from generated script')) }
    })
  })
}
const ok = r => { assert.equal(r.code, 0); assert.equal(r.data.ok, true) }
const bad = (r, code) => {
  assert.equal(r.code, code)
  assert.equal(r.data.ok, false)
  for (const field of ['stage', 'operation', 'category', 'retryable', 'operation_id', 'log_path']) {
    assert.ok(Object.hasOwn(r.data, field), 'missing error field ' + field)
  }
}
const results = []
async function test(name, fn) {
  try { await fn(); results.push({ name, status: 'passed' }); console.log('PASS ' + name) }
  catch (error) { results.push({ name, status: 'failed', error: error.message }); console.error('FAIL ' + name + ': ' + error.message) }
}

await test('prospective checks/dry-run have no filesystem side effects', async () => {
  const before = snapshot(repo)
  for (const kind of ['init', 'teardown']) for (const flag of ['--check', '--dry-run']) {
    const r = await call(kind, prefix + '-prospective', [flag])
    ok(r)
    assert.equal(r.data.contract_version, 1)
  }
  assert.deepEqual(snapshot(repo), before)
})
await test('invalid canonical names fail before provisioning', async () => {
  for (const name of ['main', 'con', 'wrong--name', 'Upper', 'a'.repeat(41)]) {
    bad(await call('init', name, ['--check']), 2)
  }
})
for (const name of names) {
  git('worktree', 'add', '-b', name, worktree(name), 'main')
  fs.copyFileSync(path.join(repo, '.env'), path.join(worktree(name), '.env'))
  write(manifest(name), { schema: 1, name, files: ['.env'] })
}
await test('object manifest accepted; arrays and identity mismatches rejected', async () => {
  const name = names[0], original = read(manifest(name))
  try {
    ok(await call('init', name, ['--check']))
    for (const invalid of [['.env'], { ...original, name: 'someone-else' },
      { ...original, schema: 2 }, { ...original, files: ['../outside'] },
      { ...original, files: ['.env.worktree'] }]) {
      write(manifest(name), invalid)
      bad(await call('init', name, ['--check']), 2)
    }
  } finally { write(manifest(name), original) }
})
await test('three concurrent initializations have unique resource allocations', async () => {
  const calls = await Promise.all(names.slice(0, 3).map(name => call('init', name)))
  calls.forEach(ok)
  assert.ok(descriptor.unique_keys?.length, 'fixture must identify unique resource output fields')
  for (const key of descriptor.unique_keys) {
    const values = calls.map(r => r.data.resources[key])
    assert.ok(values.every(value => value !== undefined), 'missing resource field ' + key)
    assert.equal(new Set(values).size, 3, 'duplicate ' + key)
  }
})
await test('same-target repeated init is idempotent', async () => {
  const before = await call('init', names[0]); ok(before)
  const calls = await Promise.all([call('init', names[0]), call('init', names[0])])
  for (const result of calls) { ok(result); assert.deepEqual(result.data.resources, before.data.resources) }
})
if (descriptor.controls?.delay) {
  await test('same-target init/teardown is excluded within the wait budget', async () => {
    assert.ok(config.operations.lock_wait_seconds <= 1, 'use a short fixture-only wait budget')
    const name = names[0], lock = path.join(stateDir, 'locks', name + '.lock')
    const running = call('init', name, [], descriptor.controls.delay)
    try {
      const deadline = Date.now() + 5000
      while (!fs.existsSync(lock) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
      assert.ok(fs.existsSync(lock), 'init never acquired its target lock')
      const started = Date.now(), blocked = await call('teardown', name)
      bad(blocked, 6)
      assert.equal(blocked.data.category, 'lock_busy')
      assert.ok(Date.now() - started < (config.operations.lock_wait_seconds * 1000) + 1500,
        'lock acquisition exceeded bounded waiting plus process overhead')
    } finally { ok(await running) }
  })
}
if (descriptor.controls?.partial_failure) {
  await test('partial failure retains diagnostics and resumes the same worktree', async () => {
    const name = names[3]
    const failed = await call('init', name, [], descriptor.controls.partial_failure)
    bad(failed, 4)
    const summary = read(path.join(stateDir, name + '.json'))
    assert.equal(summary.lifecycle, 'created'); assert.equal(summary.init, 'failed')
    const resumed = await call('init', name); ok(resumed)
    const repeated = await call('init', name); ok(repeated)
    assert.deepEqual(resumed.data.resources, repeated.data.resources)
    const logs = path.join(stateDir, 'logs', name)
    assert.ok(fs.readdirSync(logs).length >= 2, 'failure log was overwritten')
    const allOutput = failed.stdout + failed.stderr + fs.readdirSync(logs)
      .map(file => fs.readFileSync(path.join(logs, file), 'utf8')).join('')
    for (const marker of descriptor.secret_markers || []) assert.ok(!allOutput.includes(marker), 'secret marker leaked')
  })
}
await test('caller-held operation lease is preserved and mismatches fail', async () => {
  const name = names[0], operation_id = randomUUID(), lock = path.join(stateDir, 'locks', name + '.lock')
  assert.ok(!fs.existsSync(lock))
  write(lock, { operation_id, kind: 'create', name, target: worktree(name), started_at: new Date().toISOString() })
  try {
    ok(await call('init', name, ['--operation-id', operation_id]))
    assert.equal(read(lock).operation_id, operation_id)
    bad(await call('teardown', name, ['--operation-id', 'wrong-id']), 6)
  } finally { if (read(lock).operation_id === operation_id) fs.unlinkSync(lock) }
  bad(await call('init', name, ['--operation-id', operation_id]), 6)
})
await test('copied env and unmanaged keys survive teardown and repeated teardown', async () => {
  const name = names[1], env = path.join(worktree(name), '.env.worktree')
  const original = fs.readFileSync(path.join(worktree(name), '.env'))
  write(env, 'UNMANAGED=keep\nPORT=9\n')
  ok(await call('init', name))
  ok(await call('teardown', name)); ok(await call('teardown', name))
  assert.deepEqual(fs.readFileSync(path.join(worktree(name), '.env')), original)
  assert.match(fs.readFileSync(env, 'utf8'), /^UNMANAGED=keep$/m)
  assert.doesNotMatch(fs.readFileSync(env, 'utf8'), /^PORT=/m)
})
const reportPath = path.join(stateDir, prefix + '-regression.json')
write(reportPath, { platform: process.platform, runner, results, worktrees: names.map(worktree) })
console.log('Evidence: ' + reportPath)
process.exitCode = results.some(r => r.status === 'failed') ? 1 : 0
