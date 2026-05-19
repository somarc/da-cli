import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { createClient } from '../lib/da-client.js';
import { print, info, verbose } from '../lib/output.js';
import { guardWrite, simpleDiff } from '../lib/mutation.js';
import { resolveConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { DaApiError } from '../lib/da-client.js';
import { listContentPaths } from '../lib/paths.js';

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

  // ─── tree ─────────────────────────────────────────────────────────────────
  content
    .command('tree [prefix]')
    .description('Recursively list source documents under a prefix; useful for bulk preview/publish inputs')
    .option('--ext <ext>', 'Filter by extension, for example html')
    .action(async (prefix = '/', opts) => {
      const client = await createClient();
      try {
        const paths = await listContentPaths(client, prefix, { ext: opts.ext });
        if (paths.length === 0) {
          info('(empty)');
          return;
        }
        print(paths.map((path) => ({ path })));
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
      const normalizedPath = normalizeHtmlPath(path);
      if (normalizedPath !== path) {
        verbose(`Path normalized: ${path} → ${normalizedPath} (EDS reads .html)`);
        path = normalizedPath;
      }
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

      const normalizedPath = normalizeHtmlPath(path, file);
      if (normalizedPath !== path) {
        info(`Note: path normalized to ${normalizedPath} — EDS reads .html; extensionless paths are skipped by the content pipeline`);
        path = normalizedPath;
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

// Exported for testing — pure path normalization with no side effects.
// DA stores both extensionless (/index) and .html (/index.html) as separate docs.
// EDS preview pipeline reads only the .html version — extensionless writes are silently ignored.
// When the local file is HTML and the DA path has no extension, append .html.
export function normalizeHtmlPath(daPath, localFile = '') {
  if (daPath === '/') return '/index.html';
  const hasExt = /\.[^/]+$/.test(daPath.replace(/\/$/, ''));
  if (!hasExt && (localFile === '' || /\.html?$/i.test(localFile))) {
    return `${daPath}.html`;
  }
  return daPath;
}

// Exported for testing — pure detection with no side effects.
export function fragmentDiagnostic(html, path) {
  if (!/\.html?$/i.test(path)) return null;
  if (/<main[\s>]/i.test(html)) return null;
  return { missingBody: !/<body[\s>]/i.test(html) };
}

// DA stores HTML as-is. Helix extracts only content inside <main>.
function warnIfFragment(html, path) {
  const diag = fragmentDiagnostic(html, path);
  if (!diag) return;
  console.error(`Warning: ${path} has no <main> wrapper.`);
  console.error('  Helix extracts only <main> content — this document will render empty.');
  if (diag.missingBody) {
    console.error('  Full EDS structure needed: <body><header></header><main>...</main><footer></footer></body>');
  } else {
    console.error('  Add <main> around your page content.');
  }
  console.error('');
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
