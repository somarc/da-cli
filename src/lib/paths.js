import { createClient } from './da-client.js';

/**
 * Resolve a source argument to an array of DA paths.
 * - If source is a local file: read newline-delimited paths from it.
 * - Otherwise: treat as a DA path prefix and recursively list all files under it.
 */
export async function resolvePaths(source) {
  const { statSync } = await import('node:fs');
  try {
    if (statSync(source).isFile()) {
      const { readFile } = await import('node:fs/promises');
      const text = await readFile(source, 'utf8');
      return text.split('\n').map((l) => l.trim()).filter(Boolean);
    }
  } catch {
    // not a local file — fall through to DA prefix listing
  }

  const client = await createClient();
  const start = source.replace(/\*$/, '').replace(/\/$/, '') || '/';
  const results = [];
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    const data = await client.list(current);
    const items = Array.isArray(data) ? data : (data?.sources ?? []);
    for (const item of items) {
      const rel = item.path.replace(`/${client.org}/${client.repo}`, '');
      if (item.ext) results.push(rel);
      else queue.push(rel);
    }
  }
  return results;
}

/**
 * Run an array of async tasks with a bounded concurrency pool.
 */
export async function runConcurrent(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}
