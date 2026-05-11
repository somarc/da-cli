// Browser UA required — admin.da.live is behind Cloudflare bot protection
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BASE_URLS = {
  prod:  'https://admin.da.live',
  stage: 'https://stage-admin.da.live',
  dev:   'https://stage-admin.da.live',
};

export class DaClient {
  constructor({ org, repo, env = 'prod', token }) {
    if (!org) throw new Error('org is required — run `da config set org <org>` or pass --org');
    if (!token) throw new Error('no auth token — run `da auth login` first');
    this.org = org;
    this.repo = repo;
    this.baseUrl = BASE_URLS[env] ?? BASE_URLS.prod;
    this.token = token;
  }

  async _fetch(endpoint, { method = 'GET', body, headers = {} } = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'User-Agent': UA,
        ...headers,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new DaApiError(res.status, url, text);
    }

    return res;
  }

  // /list endpoint — directory listing
  async list(path = '') {
    const suffix = path ? `/${path.replace(/^\//, '')}` : '';
    const res = await this._fetch(`/list/${this.org}/${this._repoRequired()}${suffix}`);
    return res.json();
  }

  // /source endpoints
  async sourceGet(path) {
    return this._fetch(`/source/${this.org}/${this._repoRequired()}${normalizePath(path)}`);
  }

  async sourcePut(path, body, contentType = 'text/html') {
    const form = new FormData();
    form.append('data', new Blob([body], { type: contentType }), 'content');
    return this._fetch(`/source/${this.org}/${this._repoRequired()}${normalizePath(path)}`, {
      method: 'POST',
      body: form,
    });
  }

  async sourceDelete(path) {
    return this._fetch(`/source/${this.org}/${this._repoRequired()}${normalizePath(path)}`, {
      method: 'DELETE',
    });
  }

  // /versionlist endpoint
  async versionList(path) {
    const res = await this._fetch(`/versionlist/${this.org}/${this._repoRequired()}${normalizePath(path)}`);
    return res.json();
  }

  // /copy and /move — body is JSON {sourcePath, destinationPath}
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

  // /preview endpoint (DA editor preview, not EDS site preview)
  async daPreview(path) {
    return this._fetch(`/preview/${this.org}/${this._repoRequired()}${normalizePath(path)}`, {
      method: 'POST',
    });
  }

  // /live endpoint (publish to CDN)
  async livePost(path) {
    return this._fetch(`/live/${this.org}/${this._repoRequired()}${normalizePath(path)}`, {
      method: 'POST',
    });
  }

  async liveDelete(path) {
    return this._fetch(`/live/${this.org}/${this._repoRequired()}${normalizePath(path)}`, {
      method: 'DELETE',
    });
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

function normalizePath(p) {
  return p.startsWith('/') ? p : `/${p}`;
}

// Factory — reads context and auth, constructs a ready DaClient
export async function createClient(overrides = {}) {
  const { resolveConfig } = await import('./config.js');
  const { getToken } = await import('./auth.js');

  const { org, repo, env } = await resolveConfig(overrides);
  const token = await getToken();
  return new DaClient({ org, repo, env, token });
}
