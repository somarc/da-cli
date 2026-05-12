import { Command } from 'commander';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { load as parseYaml } from 'js-yaml';
import { getGlobals } from '../lib/context.js';
import { print, info } from '../lib/output.js';

const __filename = fileURLToPath(import.meta.url);
const BIN = join(dirname(__filename), '../../bin/da.js');
const RUN_DIR = join(homedir(), '.da', 'pipeline-runs');

export function makePipelineCommand() {
  const pipeline = new Command('pipeline').description('Execute declarative YAML pipeline DAGs');

  // ─── run ───────────────────────────────────────────────────────────────────
  pipeline
    .command('run <yaml-file>')
    .description('Execute a pipeline YAML file (steps run in dependency order)')
    .action(async (yamlFile) => {
      const raw = await readFile(yamlFile, 'utf8').catch(() => {
        console.error(`Cannot read ${yamlFile}`); process.exit(1);
      });

      let doc;
      try { doc = parseYaml(raw); }
      catch (e) { console.error(`YAML parse error: ${e.message}`); process.exit(1); }

      const pipelineDef = doc.pipeline ?? doc;
      const steps = pipelineDef.steps ?? [];
      if (steps.length === 0) { info('No steps defined.'); return; }

      validatePipeline(steps);
      const batches = topoSort(steps);
      const stepMap = new Map(steps.map((s) => [s.id, s]));
      const pipelineContext = pipelineDef.context ?? {};

      const runId = randomUUID().slice(0, 8);
      await mkdir(RUN_DIR, { recursive: true });
      const runPath = join(RUN_DIR, `${runId}.json`);

      const runState = {
        _meta: {
          runId,
          name: pipelineDef.name ?? yamlFile,
          startedAt: new Date().toISOString(),
          status: 'running',
        },
      };
      for (const s of steps) runState[s.id] = { status: 'pending' };
      await writeFile(runPath, JSON.stringify(runState, null, 2));

      info(`Pipeline run ${runId} started: ${pipelineDef.name ?? yamlFile}`);
      info(`State: ${runPath}`);

      try {
        for (const batch of batches) {
          // Check for abort before each batch
          const freshState = JSON.parse(await readFile(runPath, 'utf8'));
          if (freshState._meta?.status === 'aborted') {
            info('Pipeline aborted.');
            runState._meta.status = 'aborted';
            runState._meta.completedAt = freshState._meta.abortedAt ?? new Date().toISOString();
            break;
          }

          await Promise.all(batch.map(async (step) => {
            if (step.requires_approval) {
              await waitForApproval(step.id);
            }

            runState[step.id] = { status: 'running', startedAt: new Date().toISOString() };
            await writeFile(runPath, JSON.stringify(runState, null, 2));
            info(`→ ${step.id}: ${step.command}`);

            const timeout = parseTimeout(step.timeout);
            try {
              const exitCode = await executeStep(step, pipelineContext, timeout);
              runState[step.id] = {
                status: exitCode === 0 ? 'completed' : 'failed',
                exitCode,
                completedAt: new Date().toISOString(),
              };
              if (exitCode !== 0 && !step.continue_on_error) {
                throw new Error(`Step "${step.id}" failed (exit ${exitCode})`);
              }
            } catch (err) {
              runState[step.id] = { status: 'failed', error: err.message, completedAt: new Date().toISOString() };
              if (!step.continue_on_error && step.fail_fast !== false) throw err;
            }
            await writeFile(runPath, JSON.stringify(runState, null, 2));
          }));
        }

        if (runState._meta.status !== 'aborted') {
          runState._meta.status = 'completed';
          runState._meta.completedAt = new Date().toISOString();
        }
      } catch (err) {
        runState._meta.status = 'failed';
        runState._meta.error = err.message;
        runState._meta.completedAt = new Date().toISOString();
        console.error(`Pipeline failed: ${err.message}`);
      }

      await writeFile(runPath, JSON.stringify(runState, null, 2));
      info(`\nPipeline ${runState._meta.status}: ${runId}`);
      printRunState(runState);

      if (runState._meta.status === 'failed') process.exit(1);
    });

  // ─── status ────────────────────────────────────────────────────────────────
  pipeline
    .command('status [run-id]')
    .description('Show pipeline run progress')
    .action(async (runId) => {
      if (!runId) {
        let entries = [];
        try { entries = (await readdir(RUN_DIR)).filter((f) => f.endsWith('.json')); }
        catch { info('No pipeline runs found.'); return; }
        if (!entries.length) { info('No pipeline runs found.'); return; }

        const rows = [];
        for (const f of entries) {
          try {
            const state = JSON.parse(await readFile(join(RUN_DIR, f), 'utf8'));
            const { _meta, ...steps } = state;
            const stepVals = Object.values(steps);
            rows.push({
              runId: _meta?.runId ?? f.replace('.json', ''),
              name: _meta?.name ?? '',
              status: _meta?.status ?? '',
              steps: stepVals.length,
              done: stepVals.filter((s) => s.status === 'completed').length,
              failed: stepVals.filter((s) => s.status === 'failed').length,
              startedAt: _meta?.startedAt?.slice(0, 19) ?? '',
            });
          } catch { /* skip */ }
        }
        print(rows);
        return;
      }

      const runPath = join(RUN_DIR, `${runId}.json`);
      let state;
      try { state = JSON.parse(await readFile(runPath, 'utf8')); }
      catch { console.error(`Run ${runId} not found.`); process.exit(1); }
      printRunState(state);
    });

  // ─── abort ─────────────────────────────────────────────────────────────────
  pipeline
    .command('abort <run-id>')
    .description('Signal a running pipeline to stop before its next batch')
    .action(async (runId) => {
      const runPath = join(RUN_DIR, `${runId}.json`);
      let state;
      try { state = JSON.parse(await readFile(runPath, 'utf8')); }
      catch { console.error(`Run ${runId} not found.`); process.exit(1); }

      if (state._meta?.status !== 'running') {
        console.error(`Run ${runId} is not running (status: ${state._meta?.status}).`);
        process.exit(1);
      }

      state._meta.status = 'aborted';
      state._meta.abortedAt = new Date().toISOString();
      await writeFile(runPath, JSON.stringify(state, null, 2));
      info(`Abort signal written for run ${runId}. In-flight steps will complete.`);
    });

  return pipeline;
}

// ── execution engine ──────────────────────────────────────────────────────────

function executeStep(step, pipelineContext, timeoutMs) {
  const globals = getGlobals();

  // Build root-level flags from pipeline context + inherited globals
  const rootFlags = [];
  const org = pipelineContext.org ?? globals.org;
  const repo = pipelineContext.repo ?? globals.repo;
  const env = pipelineContext.env ?? globals.env;
  if (org) rootFlags.push('--org', org);
  if (repo) rootFlags.push('--repo', repo);
  if (env) rootFlags.push('--env', env);
  if (globals.commit) rootFlags.push('--commit');
  if (globals.dryRun) rootFlags.push('--dry-run');
  if (globals.format) rootFlags.push('--format', globals.format);

  // Parse the step's command string into argv
  const args = parseCommandString(step.command);
  const argv = [...rootFlags, ...args];

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [BIN, ...argv], {
      env: { ...process.env, ...(step.env ?? {}) },
      stdio: 'inherit',
    });

    let timer;
    if (timeoutMs) {
      timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Step "${step.id}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    proc.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      resolve(code ?? 1);
    });
    proc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

// ── pipeline validation + sorting ─────────────────────────────────────────────

function validatePipeline(steps) {
  const ids = new Set(steps.map((s) => s.id));
  for (const step of steps) {
    if (!step.id) throw new Error(`A step is missing an 'id' field`);
    if (!step.command) throw new Error(`Step "${step.id}" is missing a 'command' field`);
    for (const dep of step.depends_on ?? []) {
      if (!ids.has(dep)) throw new Error(`Step "${step.id}" depends_on unknown step "${dep}"`);
    }
  }
}

// Kahn's algorithm — returns ordered batches of steps that can run in parallel.
function topoSort(steps) {
  const inDegree = new Map(steps.map((s) => [s.id, 0]));
  const adjacency = new Map(steps.map((s) => [s.id, []]));

  for (const step of steps) {
    for (const dep of step.depends_on ?? []) {
      adjacency.get(dep).push(step.id);
      inDegree.set(step.id, inDegree.get(step.id) + 1);
    }
  }

  const stepMap = new Map(steps.map((s) => [s.id, s]));
  let queue = steps.filter((s) => inDegree.get(s.id) === 0);
  const batches = [];

  while (queue.length > 0) {
    batches.push([...queue]);
    const nextQueue = [];
    for (const step of queue) {
      for (const dependentId of adjacency.get(step.id)) {
        const newDegree = inDegree.get(dependentId) - 1;
        inDegree.set(dependentId, newDegree);
        if (newDegree === 0) nextQueue.push(stepMap.get(dependentId));
      }
    }
    queue = nextQueue;
  }

  if (batches.flat().length !== steps.length) {
    throw new Error('Pipeline has a dependency cycle');
  }
  return batches;
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function waitForApproval(stepId) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.question(`\nApproval required for step "${stepId}". Proceed? [y/N] `, (answer) => {
      rl.close();
      if (answer.trim().toLowerCase() === 'y') resolve();
      else reject(new Error(`Step "${stepId}" approval denied`));
    });
  });
}

function parseTimeout(str) {
  if (!str) return null;
  const m = /^(\d+)(s|m|h)$/.exec(String(str));
  if (!m) return null;
  return parseInt(m[1]) * { s: 1000, m: 60_000, h: 3_600_000 }[m[2]];
}

// Naive command string → argv (handles quoted strings, no shell expansion).
function parseCommandString(cmd) {
  const args = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = true; quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) { args.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

function printRunState(state) {
  const { _meta, ...steps } = state;
  if (_meta) {
    info(`\nRun: ${_meta.runId ?? ''} | ${_meta.name ?? ''} | ${_meta.status ?? ''}`);
  }
  const rows = Object.entries(steps).map(([id, s]) => ({
    step: id,
    status: s.status,
    exitCode: s.exitCode ?? '',
    startedAt: s.startedAt?.slice(11, 19) ?? '',
    completedAt: s.completedAt?.slice(11, 19) ?? '',
    error: s.error ?? '',
  }));
  print(rows);
}

// ── test exports ──────────────────────────────────────────────────────────────
export { validatePipeline, topoSort, parseCommandString, parseTimeout };
