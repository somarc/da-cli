import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { buildLiveUrl, canonicalWebPath, createClient, DaApiError } from '../lib/da-client.js';
import { print, info, verbose } from '../lib/output.js';
import { guardWrite, printWritePreflight, simpleDiff } from '../lib/mutation.js';
import { listContentPaths } from '../lib/paths.js';
import {
  cloneWorkspace,
  commitWorkspace,
  mergeWorkspace,
  pushWorkspace,
  stage,
  workspaceDiff,
  workspaceStatus,
} from '../lib/content-workspace.js';

export function makeContentCommand() {
  const content = new Command('content').description('CRUD operations on DA source documents');

  content
    .command('clone')
    .description('Clone DA content locally into content/')
    .option('--path <path>', 'DA folder to clone, for example /blog')
    .option('--all', 'Clone the entire site content')
    .option('--force', 'Replace an existing content/ checkout')
    .action(async (opts) => {
      if (!opts.all && !opts.path) {
        console.error('Missing --path. Use --all to clone the entire site.');
        process.exit(1);
      }
      const client = await createClient();
      const result = await cloneWorkspace(client, { rootPath: opts.all ? '/' : opts.path, force: opts.force });
      info(`Cloned ${result.files} files into content/`);
    });

  content
    .command('status')
    .description('Show locally added, modified, and deleted content files')
    .action(async () => {
      const rows = await workspaceStatus();
      if (!rows.length) info('nothing to commit, working tree clean');
      else print(rows);
    });

  content
    .command('diff [path]')
    .description('Show diff between local and remote content')
    .action(async (path) => {
      const client = await createClient();
      const diff = await workspaceDiff(client, path);
      info(diff || '(no changes)');
    });

  content
    .command('add [files...]')
    .description('Stage local content changes')
    .action(async (files = []) => {
      const staged = await stage(files);
      print(staged.map((path) => ({ path })));
    });

  content
    .command('commit')
    .description('Commit staged local content changes')
    .requiredOption('-m, --message <message>', 'Commit message')
    .action(async (opts) => {
      const commit = await commitWorkspace(opts.message);
      print(commit);
    });

  content
    .command('push')
    .description('Push committed local content changes to DA — requires --commit')
    .option('--path <path>', 'Push only a specific file or subtree')
    .option('--force', 'Allow unstaged/uncommitted changes to be pushed')
    .action(async (opts) => {
      const client = await createClient();
      const plan = await pushWorkspace(client, { path: opts.path, force: opts.force, dryRun: true });
      print(plan.planned.map((path) => ({ path })));
      printWritePreflight({
        client,
        operation: 'content push',
        source: opts.path,
        paths: plan.planned,
        configSources: client.configSources,
      });
      const { proceed } = guardWrite(`Push ${plan.planned.length} local content change(s) to DA`);
      if (!proceed) return;
      const result = await pushWorkspace(client, { path: opts.path, force: opts.force });
      info(`Pushed ${result.pushed} file(s)`);
    });

  content
    .command('merge [path]')
    .description('Merge remote DA content into local content/')
    .action(async (path) => {
      const client = await createClient();
      const result = await mergeWorkspace(client, path);
      info(`Merged ${result.merged} file(s)`);
    });

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
    .description('Upload a document or binary asset — dry-run by default, shows diff for text; pass --commit to write')
    .action(async (path, file) => {
      const { readFile, stat } = await import('node:fs/promises');
      const uploadMimeType = mimeTypeForUpload(file);
      const binaryUpload = isBinaryUpload(file);

      let newContent;
      try {
        newContent = binaryUpload ? await readFile(file) : await readFile(file, 'utf8');
      } catch (err) {
        console.error(`Cannot read ${file}: ${err.message}`);
        process.exit(1);
      }

      if (!binaryUpload) {
        const normalizedPath = normalizeHtmlPath(path, file);
        if (normalizedPath !== path) {
          info(`Note: path normalized to ${normalizedPath} — EDS reads .html; extensionless paths are skipped by the content pipeline`);
          path = normalizedPath;
        }

        warnIfFragment(newContent, path);
      }

      const client = await createClient();
      const notes = [];

      if (binaryUpload) {
        const fileSize = (await stat(file)).size;
        info(`Binary upload: ${path} (${uploadMimeType}, ${(fileSize / 1024).toFixed(1)} KB)`);
        notes.push('Binary asset upload; text diff and HTML fragment checks are skipped.');
      } else {
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
        if (oldContent === null) notes.push(await newDocumentRouteNote(client, path));
      }

      printWritePreflight({
        client,
        operation: `content put ${path}`,
        source: file,
        paths: [path],
        configSources: client.configSources,
        notes,
      });

      const { proceed } = guardWrite(`Upload ${file} → ${path}`);
      if (!proceed) return;

      try {
        await client.sourcePut(path, newContent, uploadMimeType);
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
      const client = await createClient();
      printWritePreflight({
        client,
        operation: `content delete ${path}`,
        paths: [path],
        configSources: client.configSources,
      });
      if (!guardWrite(`Delete ${path}`).proceed) return;
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
      const client = await createClient();
      printWritePreflight({
        client,
        operation: `content move ${src} ${dst}`,
        paths: [src, dst],
        configSources: client.configSources,
      });
      if (!guardWrite(`Move ${src} → ${dst}`).proceed) return;
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
      const client = await createClient();
      printWritePreflight({
        client,
        operation: `content copy ${src} ${dst}`,
        paths: [src, dst],
        configSources: client.configSources,
      });
      if (!guardWrite(`Copy ${src} → ${dst}`).proceed) return;
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

const BINARY_UPLOAD_MIME_TYPES = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
};

export function mimeTypeForUpload(localFile = '') {
  const ext = localFile.match(/(\.[^./\\]+)$/)?.[1]?.toLowerCase();
  return BINARY_UPLOAD_MIME_TYPES[ext] ?? 'text/html';
}

export function isBinaryUpload(localFile = '') {
  return mimeTypeForUpload(localFile) !== 'text/html';
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

async function newDocumentRouteNote(client, path) {
  const liveUrl = buildLiveUrl(client, path);
  try {
    const res = await fetch(liveUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (res.ok) {
      return `New DA source, but canonical live route ${canonicalWebPath(path)} currently returns ${res.status}. Run: da route canonical ${canonicalWebPath(path)}`;
    }
    return `New DA source; canonical live route ${canonicalWebPath(path)} currently returns ${res.status}.`;
  } catch (err) {
    return `New DA source; live route check failed for ${canonicalWebPath(path)}: ${err.message}`;
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
