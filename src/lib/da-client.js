// Browser UA required — admin.da.live is behind Cloudflare bot protection
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BASE_URLS = {
  prod:  'https://admin.da.live',
  stage: 'https://stage-admin.da.live',
  dev:   'https://stage-admin.da.live',
};

const HELIX_ADMIN = 'https://admin.hlx.page';

export class DaClient {
  constructor({ org, repo, env = 'prod', branch = 'main', token }) {
    if (!org) throw new Error('org is required — run `da config set org <org>` or pass --org');
    if (!token) throw new Error('no auth token — run `da auth login` first');
    this.org = org;
    this.repo = repo;
    this.branch = branch;
    this.baseUrl = BASE_URLS[env] ?? BASE_URLS.prod;
    this.token = token;
  }

  async _fetch(endpoint, { method = 'GET', body, headers = {} } = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'User-Agent': UA, ...headers },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DaApiError(res.status, url, text);
    }
    return res;
  }

  async _helixFetch(endpoint, { method = 'GET', headers = {} } = {}) {
    const url = `${HELIX_ADMIN}${endpoint}`;
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'User-Agent': UA, ...headers },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DaApiError(res.status, url, text);
    }
    return res;
  }

  // ── DA /list ────────────────────────────────────────────────────────────────
  async list(path = '') {
    const suffix = path ? `/${path.replace(/^\//, '')}` : '';
    const res = await this._fetch(`/list/${this.org}/${this._repoRequired()}${suffix}`);
    return res.json();
  }

  // ── DA /source ──────────────────────────────────────────────────────────────
  async sourceGet(path) {
    return this._fetch(`/source/${this.org}/${this._repoRequired()}${norm(path)}`);
  }

  async sourcePut(path, body, contentType = 'text/html') {
    const form = new FormData();
    form.append('data', new Blob([body], { type: contentType }), 'content');
    return this._fetch(`/source/${this.org}/${this._repoRequired()}${norm(path)}`, {
      method: 'POST',
      body: form,
    });
  }

  async sourceDelete(path) {
    return this._fetch(`/source/${this.org}/${this._repoRequired()}${norm(path)}`, {
      method: 'DELETE',
    });
  }

  async versionList(path) {
    const res = await this._fetch(`/versionlist/${this.org}/${this._repoRequired()}${norm(path)}`);
    return res.json();
  }

  async copy(sourcePath, destinationPath) {
    return this._fetch(`/copy/${this.org}/${this._repoRequired()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath, destinationPath }),
    });
  }

  async move(sourcePath, destinationPath) {
    return this._fetch(`/move/${this.org}/${this._repoRequired()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath, destinationPath }),
    });
  }

  // ── DA /preview (DA editor flush only, not EDS pipeline) ────────────────────
  async daPreviewFlush(path) {
    return this._fetch(`/preview/${this.org}/${this._repoRequired()}${norm(path)}`, {
      method: 'POST',
    });
  }

  // ── Helix admin preview (EDS content pipeline) ──────────────────────────────
  // POST is synchronous — returns when preview is built.
  async helixPreview(path) {
    const res = await this._helixFetch(
      `/preview/${this.org}/${this._repoRequired()}/${this.branch}/${helixPath(path)}`,
      { method: 'POST' },
    );
    return res.json();
  }

  async helixPreviewStatus(path) {
    const res = await this._helixFetch(
      `/status/${this.org}/${this._repoRequired()}/${this.branch}/${helixPath(path)}`,
    );
    return res.json();
  }

  // ── Helix admin live (CDN publish / unpublish) ───────────────────────────────
  async helixLive(path) {
    const res = await this._helixFetch(
      `/live/${this.org}/${this._repoRequired()}/${this.branch}/${helixPath(path)}`,
      { method: 'POST' },
    );
    return res.json();
  }

  async helixUnpublish(path) {
    const res = await this._helixFetch(
      `/live/${this.org}/${this._repoRequired()}/${this.branch}/${helixPath(path)}`,
      { method: 'DELETE' },
    );
    return res.json().catch(() => ({}));
  }

  // ── Helix admin code bus ─────────────────────────────────────────────────────
  // Triggers a code-bus sync for a path (kicks the CDN invalidation for JS/CSS/etc.)
  async helixCodeSync(path) {
    const res = await this._helixFetch(
      `/code/${this.org}/${this._repoRequired()}/${this.branch}/${helixPath(path)}`,
      { method: 'POST' },
    );
    return res.json().catch(() => ({}));
  }

  async helixCodeStatus(path) {
    const res = await this._helixFetch(
      `/code/${this.org}/${this._repoRequired()}/${this.branch}/${helixPath(path)}`,
    );
    return res.json();
  }

  // ── Helix async job polling ──────────────────────────────────────────────────
  async helixJob(jobId) {
    const res = await this._helixFetch(`/job/${jobId}/details`);
    return res.json();
  }

  // Poll a job until it reaches a terminal state (success/stopped/failed).
  async helixJobWait(jobId, { intervalMs = 2000, timeoutMs = 120_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = await this.helixJob(jobId);
      const state = job?.state ?? job?.status;
      if (state === 'stopped' || state === 'failed' || state === 'success') return job;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Job ${jobId} did not complete within ${timeoutMs / 1000}s`);
  }

  // ── Helix bulk preview/publish ───────────────────────────────────────────────
  // Submits a bulk job and returns the job descriptor immediately.
  async helixBulkPreview(paths) {
    const res = await this._helixFetch(
      `/preview/${this.org}/${this._repoRequired()}/${this.branch}/*`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: paths.map((p) => helixPath(p)) }),
      },
    );
    return res.json();
  }

  async helixBulkLive(paths) {
    const res = await this._helixFetch(
      `/live/${this.org}/${this._repoRequired()}/${this.branch}/*`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: paths.map((p) => helixPath(p)) }),
      },
    );
    return res.json();
  }

  // ── Helix sidekick config ────────────────────────────────────────────────────
  async helixSidekickConfig() {
    const res = await this._helixFetch(
      `/sidekick/${this.org}/${this._repoRequired()}`,
    );
    return res.json();
  }

  async helixSidekickUpdate(cfg) {
    const res = await this._helixFetch(
      `/sidekick/${this.org}/${this._repoRequired()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      },
    );
    return res.json().catch(() => ({}));
  }

  // ── Helix CDN cache purge ────────────────────────────────────────────────────
  async helixCachePurge(path) {
    const res = await this._helixFetch(
      `/cache/${this.org}/${this._repoRequired()}/${this.branch}/${helixPath(path)}`,
      { method: 'POST' },
    );
    return res.json().catch(() => ({}));
  }

  // ── Public page fetch (no auth, reads from aem.page / aem.live) ─────────────
  // Used by design detect and stardust extract to read rendered EDS pages.
  async fetchPage(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new DaApiError(res.status, url, '');
    return res.text();
  }

  // Instance method — uses configured branch (not hardcoded 'main')
  async fetchPlainHtml(path) {
    return fetchPlainHtml({ org: this.org, repo: this._repoRequired(), branch: this.branch }, path);
  }

  _repoRequired() {
    if (!this.repo) throw new Error('repo is required — run `da config set repo <repo>` or pass --repo');
    return this.repo;
  }
}

export class DaApiError extends Error {
  constructor(status, url, body) {
    super(`DA API ${status} at ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

// DA admin paths always need a leading slash
function norm(p) {
  return p.startsWith('/') ? p : `/${p}`;
}

// Helix admin uses web paths (no .html extension, no leading slash in URL segment)
function helixPath(p) {
  return p.replace(/\.html$/, '').replace(/^\//, '') || 'index';
}

// Static unauthenticated helper — used by `da design` and `da stardust` when no
// auth token is available or needed (reads from public aem.page preview URLs).
export async function fetchPlainHtml({ org, repo, branch = 'main' }, path) {
  const plain = path.replace(/\.html$/, '') + '.plain.html';
  const url = `https://${branch}--${repo}--${org}.aem.page${norm(plain)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new DaApiError(res.status, url, '');
  return res.text();
}

// Factory — reads context and auth, constructs a ready DaClient
export async function createClient(overrides = {}) {
  const { resolveConfig } = await import('./config.js');
  const { getToken } = await import('./auth.js');

  const { org, repo, env, config } = await resolveConfig(overrides);
  const token = await getToken();
  return new DaClient({ org, repo, env, branch: config.branch ?? 'main', token });
}
