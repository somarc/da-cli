import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { createClient } from '../lib/da-client.js';
import { print, info, verbose } from '../lib/output.js';
import { guardWrite, simpleDiff } from '../lib/mutation.js';
import { resolveConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { DaApiError } from '../lib/da-client.js';

export function makeContentCommand() {
  const content = new Command('content').description('CRUD operations on DA source documents');

  // ─── list ──────────────────────────────────────────────────────────────────
  content
    .command('list [path]')
    .description('List documents and folders at path (default: repo root)')
    .action(async (path = '') => {
      const client = await createClient();
      try {
        const data = await client.list(path);
        // /list returns a flat array: [{path, name, ext?, lastModified}]
        // directories have no ext field
        const sources = Array.isArray(data) ? data : (data?.sources ?? []);
        if (sources.length === 0) {
          info('(empty)');
          return;
        }
        const rows = sources.map((s) => ({
          name: s.ext ? `${s.name}.${s.ext}` : `${s.name}/`,
          type: s.ext ? 'file' : 'dir',
          lastModified: s.lastModified
            ? new Date(s.lastModified).toISOString().replace('T', ' ').slice(0, 19)
            : '',
        }));
        print(rows);
      } catch (err) {
        handleApiError(err);
      }
    });

  // ─── get ───────────────────────────────────────────────────────────────────
  content
    .command('get <path>')
    .description('Fetch source document to stdout or --output <file>')
    .option('-o, --output <file>', 'Write content to file instead of stdout')
    .action(async (path, opts) => {
      const client = await createClient();
      try {
        const res = await client.sourceGet(path);
        const text = await res.text();

        if (opts.output) {
          await writeFile(opts.output, text, 'utf8');
          info(`Written to ${opts.output} (${text.length} bytes)`);
        } else {
          process.stdout.write(text);
        }
      } catch (err) {
        handleApiError(err);
      }
    });

  // ─── put ───────────────────────────────────────────────────────────────────
  content
    .command('put <path> <file>')
    .description('Upload a document — dry-run by default, shows diff; pass --commit to write')
    .action(async (path, file) => {
      const { readFile } = await import('node:fs/promises');
      let newContent;
      try {
        newContent = await readFile(file, 'utf8');
      } catch (err) {
        console.error(`Cannot read ${file}: ${err.message}`);
        process.exit(1);
      }

      warnIfFragment(newContent, path);

      const client = await createClient();

      // Fetch existing content to show diff before the guard gate
      let oldContent = null;
      try {
        const res = await client.sourceGet(path);
        oldContent = await res.text();
      } catch (err) {
        if (!(err instanceof DaApiError && err.status === 404)) throw err;
      }

      const diffText = simpleDiff(oldContent ?? '', newContent);
      info(oldContent === null ? `New document: ${path}` : `Diff for ${path}:`);
      if (oldContent !== null) info(diffText);

      const { proceed } = guardWrite(`Upload ${file} → ${path}`);
      if (!proceed) return;

      try {
        await client.sourcePut(path, newContent);
        info(`Uploaded ${path}`);
      } catch (err) {
        handleApiError(err);
      }
    });

  // ─── delete ────────────────────────────────────────────────────────────────
  content
    .command('delete <path>')
    .description('Delete source document — requires --commit')
    .action(async (path) => {
      if (!guardWrite(`Delete ${path}`).proceed) return;
      const client = await createClient();
      try {
        await client.sourceDelete(path);
        info(`Deleted ${path}`);
      } catch (err) {
        handleApiError(err);
      }
    });

  // ─── move ──────────────────────────────────────────────────────────────────
  content
    .command('move <src> <dst>')
    .description('Move/rename a document — requires --commit')
    .action(async (src, dst) => {
      if (!guardWrite(`Move ${src} → ${dst}`).proceed) return;
      const client = await createClient();
      try {
        await client.move(src, dst);
        info(`Moved ${src} → ${dst}`);
      } catch (err) {
        handleApiError(err);
      }
    });

  // ─── copy ──────────────────────────────────────────────────────────────────
  content
    .command('copy <src> <dst>')
    .description('Copy a document to a new path — requires --commit')
    .action(async (src, dst) => {
      if (!guardWrite(`Copy ${src} → ${dst}`).proceed) return;
      const client = await createClient();
      try {
        await client.copy(src, dst);
        info(`Copied ${src} → ${dst}`);
      } catch (err) {
        handleApiError(err);
      }
    });

  // ─── versions ──────────────────────────────────────────────────────────────
  content
    .command('versions <path>')
    .description('List version history for a document')
    .action(async (path) => {
      const client = await createClient();
      try {
        const data = await client.versionList(path);
        const versions = data?.versions ?? [];
        if (versions.length === 0) { info('No versions found.'); return; }
        const rows = versions.map((v, i) => ({
          '#': String(versions.length - i),
          timestamp: new Date(v.timestamp).toISOString().replace('T', ' ').slice(0, 19),
          users: (v.users ?? []).map((u) => u.email).join(', '),
          url: v.url ?? '',
        }));
        print(rows);
      } catch (err) {
        handleApiError(err);
      }
    });

  return content;
}

// DA stores HTML as-is. Helix extracts only content inside <main>.
// Fragments uploaded without <body><main> will preview as empty.
function warnIfFragment(html, path) {
  if (!/\.(html?)$/i.test(path)) return;
  if (!/<main[\s>]/i.test(html) && !/<body[\s>]/i.test(html)) {
    console.error(`Warning: ${path} has no <body> or <main> wrapper.`);
    console.error('  Helix extracts only <main> content — fragments will render as empty.');
    console.error('  Wrap content in: <body><header></header><main>...</main><footer></footer></body>');
    console.error('');
  }
}

function handleApiError(err) {
  if (err instanceof DaApiError) {
    if (err.status === 401) {
      console.error('Unauthorized — run `da auth login` to refresh your token');
    } else if (err.status === 404) {
      console.error(`Not found: ${err.url}`);
    } else {
      console.error(err.message);
    }
  } else {
    console.error(err.message);
  }
  process.exit(1);
}
