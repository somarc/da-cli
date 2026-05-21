import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export async function startLocalServer(options) {
  const handler = createLocalHandler(options);
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, resolve);
  });
  return server;
}

export function createLocalHandler(options) {
  const root = path.resolve(options.root ?? process.cwd());
  const contentRoot = options.content ? path.resolve(options.content) : null;
  const fallback = options.fallback ?? 'preview';

  return async (req, res) => {
    try {
      const requestPath = normalizeRequestPath(req.url);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'method not allowed');
        return;
      }

      const local = await resolveLocalFile(root, requestPath);
      if (local) {
        await sendFile(req, res, local.path, local.type);
        return;
      }

      if (contentRoot) {
        const content = await resolveContentFile(contentRoot, requestPath);
        if (content) {
          await sendFile(req, res, content.path, content.type);
          return;
        }
      }

      if (fallback !== 'none' && options.fallbackBaseUrl) {
        await proxyFallback(req, res, options.fallbackBaseUrl, requestPath);
        return;
      }

      sendText(res, 404, 'not found');
    } catch (err) {
      const status = err.statusCode ?? 500;
      sendText(res, status, status === 403 ? 'forbidden' : err.message);
    }
  };
}

export async function resolveLocalFile(root, requestPath) {
  const candidates = fileCandidates(root, requestPath);
  for (const candidate of candidates) {
    const safe = assertInside(root, candidate);
    if (await isFile(safe)) return { path: safe, type: 'local' };
  }
  return null;
}

export async function resolveContentFile(contentRoot, requestPath) {
  const normalized = requestPath === '/' ? '/index' : requestPath;
  const hasExt = Boolean(path.extname(normalized));
  const contentPath = hasExt ? normalized : `${normalized}.html`;
  const candidate = assertInside(contentRoot, path.join(contentRoot, stripLeadingSlash(contentPath)));
  if (await isFile(candidate)) return { path: candidate, type: 'content' };
  return null;
}

export function buildFallbackBaseUrl({ org, repo, branch = 'main', fallback = 'preview' }) {
  if (!org || !repo || fallback === 'none') return null;
  const domain = fallback === 'live' ? 'aem.live' : 'aem.page';
  return `https://${branch}--${repo}--${org}.${domain}`;
}

function fileCandidates(root, requestPath) {
  const clean = requestPath === '/' ? '/index.html' : requestPath;
  const rel = stripLeadingSlash(clean);
  const ext = path.extname(rel);
  const candidates = [path.join(root, rel)];
  if (!ext) {
    candidates.push(path.join(root, `${rel}.html`));
    candidates.push(path.join(root, rel, 'index.html'));
  }
  return candidates;
}

function normalizeRequestPath(url = '/') {
  const parsed = new URL(url, 'http://local.da');
  const decoded = decodeURIComponent(parsed.pathname);
  return decoded.startsWith('/') ? decoded : `/${decoded}`;
}

function stripLeadingSlash(value) {
  return String(value).replace(/^\/+/, '');
}

function assertInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    const err = new Error('path escapes server root');
    err.statusCode = 403;
    throw err;
  }
  return resolved;
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function sendFile(req, res, file, source) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'x-da-source': source,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

async function proxyFallback(req, res, baseUrl, requestPath) {
  const target = new URL(requestPath, `${baseUrl}/`);
  const upstream = await fetch(target, {
    method: req.method,
    headers: {
      'user-agent': 'da-cli-local-server',
      accept: req.headers.accept ?? '*/*',
    },
  });
  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
    'x-da-source': 'fallback',
    'x-da-fallback-url': target.toString(),
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`${text}\n`);
}

export async function hasContentWorkspace(contentDir) {
  if (!contentDir) return false;
  try {
    return (await stat(contentDir)).isDirectory();
  } catch {
    return false;
  }
}
