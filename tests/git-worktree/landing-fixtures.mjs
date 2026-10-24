#!/usr/bin/env node
// Prepare real Git scenarios, then verify an agent/executor's observable results.
// This deliberately does not implement the landing workflow under test.
// node tests/git-worktree/landing-fixtures.mjs prepare [new-directory]
// node tests/git-worktree/landing-fixtures.mjs verify <directory> [case-name]
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const runtimeContract = fs.readFileSync(path.join(sourceRoot,
  'skills/git-worktree/setup-git-worktree/references/runtime-contract.md'), 'utf8')
const names = ['stale-source', 'post-check-failure', 'pending-check-recovery',
  'conflict-recovery', 'lost-summary', 'later-integration', 'pr-exact-merge',
  'manual-pr', 'git-error']

function git(repo, args, allowed = [0]) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
  })
  assert.ifError(result.error)
  assert.ok(allowed.includes(result.status),
    `git ${args.join(' ')} exited ${result.status}: ${result.stderr}`)
  return { code: result.status, text: result.stdout.trim() }
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n')
}
function commit(repo, filename, content, message) {
  write(path.join(repo, filename), content)
  git(repo, ['add', '--', filename])
  git(repo, ['-c', 'core.hooksPath=', 'commit', '-m', message])
  return git(repo, ['rev-parse', 'HEAD']).text
}
function saveState(c, changes) {
  c.state = { ...c.state, ...changes }
  write(c.statePath, c.state)
}
function intent(c, changes = {}) {
  const record = { ...c.state, operation_id: 'fixture-original', kind: 'merge',
    source_sha: c.source, integration_before_sha: c.before, landing: 'in_progress',
    ...changes }
  write(path.join(c.stateDir, 'operations/feature/fixture-original.json'), record)
  return record
}
function land(c) {
  git(c.repo, ['merge', '--no-ff', c.source, '-m', 'Fixture landing'])
  c.merge = git(c.repo, ['rev-parse', 'HEAD']).text
  const changes = { lifecycle: 'merged', landing: 'merged', source_sha: c.source,
    integration_before_sha: c.before, merged_commit: c.merge,
    validation: { status: 'pending', verified_sha: null, checks: [] } }
  intent(c, changes)
  saveState(c, changes)
}
function prepare(root) {
  const cases = []
  for (const name of names) {
    const repo = path.join(root, name)
    fs.mkdirSync(repo)
    git(repo, ['init'])
    git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
    git(repo, ['config', 'user.name', 'Worktree Fixture'])
    git(repo, ['config', 'user.email', 'fixture@example.invalid'])
    git(repo, ['config', 'commit.gpgsign', 'false'])
    git(repo, ['config', 'core.hooksPath', ''])
    git(repo, ['config', 'core.autocrlf', 'false'])
    const config = { schema: 2, contract_version: 1, config_file: 'docs/worktree.config.json',
      storage: { mode: 'local', root: '.worktrees', namespace: '' },
      scripts: { dir: 'scripts/worktree', runner: 'node', init: 'init.mjs', teardown: 'teardown.mjs' },
      base_ref: 'main', include_file: '.worktreeinclude', state_dir: 'worktree-workflow',
      naming: { branch: 'same-as-worktree' },
      integration: { mode: 'direct', branch: 'main', remote: 'origin', merge: 'merge-commit',
        lock: '.git/worktree-workflow/merge.lock', require_clean_build: true,
        pr_tool: 'manual', pr_merge_method: 'merge', auto_push: true },
      operations: { lock_wait_seconds: 0.2 },
      validation: { checks: [{ name: 'build', argv: [process.execPath, 'check.mjs'],
        cwd: '.', phases: ['pre_merge', 'post_merge'], required: true }] },
      resources: { shared: [], isolated: [] }, cleanup: [] }
    if (name.startsWith('pr-') || name === 'manual-pr') config.integration.mode = 'pull-request'
    if (name === 'git-error') config.integration.branch = 'missing-integration'
    write(path.join(repo, '.gitignore'), '.worktrees/\n')
    write(path.join(repo, '.worktreeinclude'), '# No copied files in landing-only fixtures.\n')
    write(path.join(repo, 'docs/worktree.config.json'), config)
    write(path.join(repo, 'docs/worktree.md'), '<!-- worktree-workflow-doc v1 -->\n' +
      '```yaml worktree-config\n' + JSON.stringify(config, null, 2) + '\n```\n\n' + runtimeContract)
    write(path.join(repo, 'AGENTS.md'), '<!-- BEGIN worktree-workflow v1 -->\n' +
      'Workflow doc: docs/worktree.md\n<!-- END worktree-workflow v1 -->\n')
    write(path.join(repo, 'check.mjs'), `import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const common = path.resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], {encoding:'utf8'}).trim());
const head = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
fs.appendFileSync(path.join(common, 'fixture-checks.jsonl'), JSON.stringify({head,cwd:process.cwd()})+'\\n');
if (fs.existsSync(path.join(common, 'fail-post-check')) && !fs.statSync('.git').isFile()) {
  console.error('fixture: required integration check failed'); process.exit(7);
}
console.log('fixture build passed at '+head);
`)
    write(path.join(repo, 'shared.txt'), 'base\n')
    git(repo, ['add', '.'])
    git(repo, ['-c', 'core.hooksPath=', 'commit', '-m', 'Local fixture baseline'])
    const base = git(repo, ['rev-parse', 'HEAD']).text
    const worktree = path.join(repo, '.worktrees/feature')
    git(repo, ['worktree', 'add', '-b', 'feature', worktree, base])
    git(repo, ['worktree', 'lock', '--reason', 'worktree-workflow: feature', worktree])
    const source = name === 'conflict-recovery'
      ? commit(worktree, 'shared.txt', 'feature\n', 'Feature edit')
      : commit(worktree, 'feature.txt', 'feature\n', 'Feature edit')
    const before = name === 'conflict-recovery'
      ? commit(repo, 'shared.txt', 'integration\n', 'Integration edit')
      : commit(repo, 'integration.txt', 'integration\n', 'Integration edit')
    const stateDir = path.join(repo, '.git/worktree-workflow')
    const statePath = path.join(stateDir, 'feature.json')
    const state = { schema: 2, name: 'feature', branch: 'feature', path: worktree,
      primary_root: repo, repo_root: repo, base_ref: 'main', base_commit: base,
      integration_branch: config.integration.branch, lifecycle: 'init_ok', init: 'ok',
      copied_files: [], resources: {}, merged_commit: null, merged_at: null, pr_url: null }
    const c = { name, repo, worktree, stateDir, statePath, base, source, before, state }
    saveState(c, {})
    write(path.join(stateDir, 'feature.copied.json'), { schema: 1, name: 'feature', files: [] })
    let request = 'Merge this completed feature using merge-git-worktree; keep its worktree.'
    if (name === 'stale-source') {
      c.movedSource = commit(worktree, 'later.txt', 'unvalidated addition\n', 'Later source change')
      request = `The source validated earlier was ${source}. Land only that validated source; ` +
        'do not include later commits or override a source mismatch. Keep the worktree.'
    } else if (name === 'post-check-failure') {
      write(path.join(repo, '.git/fail-post-check'), 'fail\n')
    } else if (name === 'conflict-recovery') {
      intent(c)
      git(repo, ['merge', '--no-ff', source, '-m', 'Interrupted fixture merge'], [1])
      saveState(c, { operation_id: 'fixture-original', landing: 'conflicted',
        source_sha: source, integration_before_sha: before })
      request = 'Resume the interrupted merge for feature. Resolve shared.txt by keeping ' +
        'both integration and feature lines. I authorize resuming, not aborting. Keep the worktree.'
    } else if (['pending-check-recovery', 'lost-summary', 'later-integration', 'pr-exact-merge'].includes(name)) {
      land(c)
      if (name === 'lost-summary') {
        write(statePath, state)
        intent(c, { lifecycle: 'init_ok', merged_commit: null,
          validation: { status: 'pending', verified_sha: null, checks: [] } })
      }
      if (name === 'pending-check-recovery') {
        saveState(c, { validation: { status: 'failed', verified_sha: c.merge, checks: [] } })
      }
      if (name === 'later-integration' || name === 'pr-exact-merge') {
        c.laterHead = commit(repo, 'later-main.txt', 'later integration\n', 'Unrelated later commit')
      }
      request = 'Recover the recorded feature landing and run outstanding validation without ' +
        'creating another merge. Keep the worktree.'
    }
    if (config.integration.mode === 'pull-request') {
      const remote = path.join(root, name + '-remote.git')
      fs.mkdirSync(remote)
      git(remote, ['init', '--bare'])
      git(repo, ['remote', 'add', 'origin', remote])
      git(repo, ['push', 'origin', 'main', 'feature'])
      c.remote = remote
      if (name === 'pr-exact-merge') {
        saveState(c, { lifecycle: 'pr_open', landing: 'pending', source_sha: source,
          merged_commit: null, pr_url: 'https://example.invalid/fixture/pull/1' })
        request = 'Verify this fixture PR landing using the local remote and Git history; ' +
          'hosting metadata is unavailable. The recorded head is the merged PR head. Keep the worktree.'
      } else {
        request = 'Push feature and give manual PR creation instructions. No PR exists and no hosting ' +
          'tool is available in this local fixture. I authorize the local-remote push. Keep the worktree.'
      }
    }
    c.request = request
    c.integrationAtStart = git(repo, ['rev-parse', 'main']).text
    delete c.state
    write(path.join(root, name + '.request.txt'), request + '\n\nRepository: ' + repo +
      '\nTarget: ' + worktree + '\nOnly this disposable repository and its local remote are authorized.\n')
    cases.push(c)
  }
  write(path.join(root, 'fixtures.json'), { version: 1, cases })
  console.log(JSON.stringify({ root, scenarios: cases.length, requests: '*.request.txt' }, null, 2))
}

function verify(root, selected) {
  const manifest = read(path.join(root, 'fixtures.json'))
  assert.equal(manifest.version, 1)
  const cases = manifest.cases.filter(c => !selected || c.name === selected)
  assert.ok(cases.length, 'no matching scenario')
  for (const c of cases) {
    const state = read(c.statePath)
    const head = git(c.repo, ['rev-parse', 'main']).text
    assert.ok(fs.existsSync(c.worktree), 'user requested worktree retention')
    const locks = path.join(c.stateDir, 'locks')
    assert.ok(!fs.existsSync(path.join(locks, 'feature.lock')), 'target operation lock leaked')
    assert.ok(!fs.existsSync(path.join(c.stateDir, 'merge.lock')), 'merge lock leaked')
    if (['stale-source', 'git-error'].includes(c.name)) {
      assert.equal(head, c.integrationAtStart, 'failed gate changed integration')
      assert.notEqual(state.landing, 'merged', 'failed gate reported landing success')
    } else if (c.name === 'manual-pr') {
      assert.equal(state.lifecycle, 'pr_pending')
      assert.equal(state.pr_url, null)
      assert.equal(state.merged_commit, null)
      assert.equal(head, c.integrationAtStart)
    } else {
      assert.equal(state.lifecycle, 'merged')
      assert.equal(state.landing, 'merged')
      const parents = git(c.repo, ['rev-list', '--parents', '-n', '1', state.merged_commit]).text.split(' ')
      assert.deepEqual(parents.slice(1), [c.before, c.source])
      if (c.merge) assert.equal(state.merged_commit, c.merge, 'recorded a later HEAD or duplicate merge')
      assert.equal(git(c.repo, ['merge-base', '--is-ancestor', c.source, 'main'], [0, 1]).code, 0)
      assert.equal(git(c.repo, ['rev-list', '--count', '--merges', 'main']).text, '1')
      assert.equal(state.source_sha, c.source)
      if (c.name === 'pr-exact-merge') {
        assert.notEqual(state.merged_commit, head)
        assert.notEqual(state.validation?.status, 'passed', 'PR merge alone is not check evidence')
      } else {
        assert.equal(state.validation?.status, c.name === 'post-check-failure' ? 'failed' : 'passed')
        assert.equal(state.validation.verified_sha, head)
        assert.ok(state.validation.checks.some(check => check.phase === 'post_merge' &&
          check.checked_sha === head && check.exit_code === (c.name === 'post-check-failure' ? 7 : 0)),
        'missing SHA-bound check evidence')
        const actualChecks = fs.readFileSync(path.join(c.repo, '.git/fixture-checks.jsonl'), 'utf8')
          .trim().split('\n').map(JSON.parse)
        assert.ok(actualChecks.some(check => check.head === head && path.resolve(check.cwd) === c.repo),
          'state claims checks that were not executed on integration')
      }
      if (c.name === 'conflict-recovery') {
        const content = fs.readFileSync(path.join(c.repo, 'shared.txt'), 'utf8')
        assert.match(content, /integration/)
        assert.match(content, /feature/)
        assert.doesNotMatch(content, /<<<<<<<|=======|>>>>>>>/)
        assert.equal(git(c.repo, ['ls-files', '-u']).text, '')
      }
    }
    assert.equal(git(c.repo, ['status', '--porcelain']).text, '')
    console.log(`PASS ${c.name}`)
  }
}

const [command, directory, selected] = process.argv.slice(2)
if (command === 'prepare') {
  let root
  if (directory) {
    root = path.resolve(directory)
    assert.ok(!fs.existsSync(root), 'prepare refuses to overwrite an existing directory')
    fs.mkdirSync(root, { recursive: true })
  } else root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-landing-'))
  prepare(root)
} else if (command === 'verify' && directory) verify(path.resolve(directory), selected)
else throw new Error('Usage: landing-fixtures.mjs prepare [new-directory] | verify <directory> [case]')
