#!/usr/bin/env node
// Regression fixture for the generated init/teardown env contract.
//
// It checks that a pre-existing unmanaged key (FOO=bar) survives init and teardown,
// while the workflow-managed key is added and then removed.
//
// Usage:
//   node env-file-regression.mjs \
//     --repo <primary> --worktree <worktree> --name <name> \
//     --config <worktree.config.json> \
//     --runner node --init <init script> --teardown <teardown script> \
//     [--copied-manifest <manifest>]
//
// Run this only against a scratch worktree. Init may install dependencies and provision
// local resources; teardown is expected to clean them up.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value === undefined) {
      fail(`invalid argument near ${key ?? '<end>'}`)
    }
    args[key.slice(2)] = value
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
for (const required of ['repo', 'worktree', 'name', 'config', 'runner', 'init', 'teardown']) {
  if (!args[required]) fail(`missing --${required}`)
}

const repo = path.resolve(args.repo)
const worktree = path.resolve(args.worktree)
const configPath = path.resolve(args.config)
const initPath = path.resolve(args.init)
const teardownPath = path.resolve(args.teardown)

if (!configPath.endsWith('.json')) fail('--config must point to the JSON config file')
if (!fs.existsSync(configPath)) fail(`config not found: ${configPath}`)

let config
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
} catch (error) {
  fail(`cannot parse config: ${error.message}`)
}

const envFile = config?.env?.file
const managedKeys = config?.env?.managed_keys ?? []
if (!envFile) {
  console.log('SKIP: no env.file configured for this repository')
  process.exit(0)
}

const managedKey = managedKeys[0]
const envPath = path.resolve(worktree, envFile)
const original = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, 'utf8')
  : null

function writeTestEnv() {
  fs.mkdirSync(path.dirname(envPath), { recursive: true })
  const lines = original ? original.split(/\r?\n/) : []
  if (!lines.some((line) => line.trim() === 'FOO=bar')) lines.push('FOO=bar')
  if (managedKey && !lines.some((line) => line.trimStart().startsWith(`${managedKey}=`))) {
    lines.push(`${managedKey}=5180`)
  }
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8')
}

function restoreEnv() {
  if (original === null) {
    fs.rmSync(envPath, { force: true })
    return
  }
  fs.mkdirSync(path.dirname(envPath), { recursive: true })
  fs.writeFileSync(envPath, original, 'utf8')
}

function run(script, extra = []) {
  const scriptArgs = [
    '--repo', repo,
    '--worktree', worktree,
    '--name', args.name,
    '--config', configPath,
    '--json',
    ...extra,
  ]
  if (args['copied-manifest']) {
    scriptArgs.push('--copied-manifest', path.resolve(args['copied-manifest']))
  }
  const result = spawnSync(args.runner, [script, ...scriptArgs], {
    cwd: worktree,
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
  })
  if (result.error) fail(`${path.basename(script)} could not run: ${result.error.message}`)
  if (result.status !== 0) {
    fail(`${path.basename(script)} exited ${result.status}\n${result.stdout}\n${result.stderr}`)
  }
  const lines = String(result.stdout).trim().split(/\r?\n/)
  const last = lines[lines.length - 1]
  try {
    const payload = JSON.parse(last)
    if (payload.ok !== true) fail(`${path.basename(script)} returned ok=false: ${last}`)
  } catch {
    fail(`${path.basename(script)} last stdout line is not JSON: ${last}`)
  }
  return result
}

try {
  writeTestEnv()
  run(initPath)

  const afterInit = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  if (!afterInit.split(/\r?\n/).some((line) => line.trim() === 'FOO=bar')) {
    fail('init removed or overwrote the unmanaged FOO=bar key')
  }
  if (managedKey && !afterInit.split(/\r?\n/).some((line) => line.trimStart().startsWith(`${managedKey}=`))) {
    fail(`init did not write managed key ${managedKey}`)
  }

  run(teardownPath)

  if (!fs.existsSync(envPath)) {
    fail('teardown deleted env.file even though FOO=bar is unmanaged')
  }
  const afterTeardown = fs.readFileSync(envPath, 'utf8')
  if (!afterTeardown.split(/\r?\n/).some((line) => line.trim() === 'FOO=bar')) {
    fail('teardown removed the unmanaged FOO=bar key')
  }
  if (managedKey && afterTeardown.split(/\r?\n/).some((line) => line.trimStart().startsWith(`${managedKey}=`))) {
    fail(`teardown left managed key ${managedKey} behind`)
  }

  console.log(`PASS: ${envFile} preserved FOO=bar across init and teardown`)
} finally {
  restoreEnv()
}
