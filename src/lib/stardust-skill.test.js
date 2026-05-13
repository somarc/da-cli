import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, chmod, mkdir, rm, readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, isGlobalSkill, runUpskillUpdate } from './stardust-skill.js';

describe('isGlobalSkill', () => {
  test('returns true when skill path starts with home', () => {
    assert.equal(isGlobalSkill('/home/user/.agents/skills/stardust', '/home/user'), true);
    assert.equal(isGlobalSkill('/Users/alice/.agents/skills/stardust', '/Users/alice'), true);
  });

  test('returns false when skill path is project-local', () => {
    assert.equal(isGlobalSkill('/projects/mysite/.agents/skills/stardust', '/home/user'), false);
    assert.equal(isGlobalSkill('.agents/skills/stardust', '/home/user'), false);
  });

  test('returns false when skillPath is null', () => {
    assert.equal(isGlobalSkill(null, '/home/user'), false);
  });

  test('returns false when home is empty', () => {
    assert.equal(isGlobalSkill('/home/user/.agents/skills/stardust', ''), false);
  });
});

describe('runUpskillUpdate — binary fallback', () => {
  test('falls back to gh upskill when upskill is not in PATH', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'da-cli-test-'));
    const argsFile = join(tmpDir, 'captured-args.txt');
    const ghScript = join(tmpDir, 'gh');
    await writeFile(ghScript, `#!/bin/sh\necho "$@" > "${argsFile}"\nexit 0\n`);
    await chmod(ghScript, 0o755);

    const savedPath = process.env.PATH;
    // Restrict PATH so `upskill` is not found (ENOENT) but our fake `gh` is,
    // plus /bin:/usr/bin so the shell interpreter can run the script.
    process.env.PATH = `${tmpDir}:/bin:/usr/bin`;
    try {
      const code = await runUpskillUpdate();
      assert.equal(code, 0);
      const captured = await readFile(argsFile, 'utf8');
      assert.ok(captured.includes('upskill'), 'gh invoked with upskill subcommand');
      assert.ok(captured.includes('adobe/skills'), 'correct repo arg passed');
      assert.ok(captured.includes('--force'), '--force flag present');
    } finally {
      process.env.PATH = savedPath;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('returns ENOENT when neither upskill nor gh is in PATH', async () => {
    const savedPath = process.env.PATH;
    process.env.PATH = '/nonexistent-da-cli-test-bin';
    try {
      const code = await runUpskillUpdate();
      assert.equal(code, 'ENOENT');
    } finally {
      process.env.PATH = savedPath;
    }
  });

  test('passes -g when skill resolves under HOME', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'da-cli-test-'));
    const argsFile = join(tmpDir, 'captured-args.txt');

    // Fake upskill that records args and exits 0
    const upskillScript = join(tmpDir, 'upskill');
    await writeFile(upskillScript, `#!/bin/sh\necho "$@" > "${argsFile}"\nexit 0\n`);
    await chmod(upskillScript, 0o755);

    // Put a fake TILE.json under HOME so getSkillPath() resolves to global
    const savedHome = process.env.HOME;
    const fakeHome = join(tmpDir, 'home');
    const fakeSkillDir = join(fakeHome, '.agents', 'skills', 'stardust');
    await mkdir(fakeSkillDir, { recursive: true });
    await writeFile(join(fakeSkillDir, 'TILE.json'), JSON.stringify({ version: '0.1.0' }));

    const savedPath = process.env.PATH;
    process.env.HOME = fakeHome;
    process.env.PATH = `${tmpDir}:${savedPath}`;
    try {
      const code = await runUpskillUpdate();
      assert.equal(code, 0);
      const captured = await readFile(argsFile, 'utf8');
      assert.ok(captured.includes('-g'), '-g flag passed for global install');
    } finally {
      process.env.HOME = savedHome;
      process.env.PATH = savedPath;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('compareVersions', () => {
  test('equal versions return 0', () => {
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
    assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  });

  test('older local returns -1', () => {
    assert.equal(compareVersions('0.1.0', '0.3.0'), -1);
    assert.equal(compareVersions('0.2.9', '0.3.0'), -1);
    assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
  });

  test('newer local returns 1', () => {
    assert.equal(compareVersions('0.3.0', '0.1.0'), 1);
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  });

  test('handles missing patch segment', () => {
    assert.equal(compareVersions('0.3', '0.3.0'), 0);
    assert.equal(compareVersions('1.0', '0.9.9'), 1);
  });

  test('handles null/undefined gracefully', () => {
    assert.equal(compareVersions(null, '0.3.0'), -1);
    assert.equal(compareVersions('0.3.0', null), 1);
    assert.equal(compareVersions(null, null), 0);
  });
});
