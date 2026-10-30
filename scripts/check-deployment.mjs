import { pathToFileURL } from 'node:url';

const placeholder = /(?:example|placeholder|your|dummy|replace|fake)/i;

function validSupabaseUrl(value) {
  if (!value || value !== value.trim() || /[?#]/.test(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === '/' && !url.port
      && !placeholder.test(host)
      && host !== 'localhost' && !host.endsWith('.localhost')
      && !host.endsWith('.local') && !host.endsWith('.test')
      && !host.endsWith('.invalid')
      && !/^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
  } catch {
    return false;
  }
}

function validPublicKey(value) {
  if (!value || value !== value.trim() || placeholder.test(value)) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(value)) return true;
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return header.alg === 'HS256' && claims.role === 'anon';
  } catch {
    return false;
  }
}

function validBasePath(value, repository) {
  if (!value || !/^\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)?$/.test(value)) return false;
  if (value === '/') return true;
  const segment = value.slice(1, -1);
  if (segment === '.' || segment === '..') return false;
  if (!repository) return true;
  const repoName = repository.split('/')[1];
  return Boolean(repoName) && segment === repoName;
}

export function validateDeploymentConfig(env) {
  const errors = [];
  if (!env.VITE_SUPABASE_URL) errors.push('VITE_SUPABASE_URL is missing');
  else if (!validSupabaseUrl(env.VITE_SUPABASE_URL)) errors.push('VITE_SUPABASE_URL must be a safe HTTPS origin');

  if (!env.VITE_SUPABASE_PUBLISHABLE_KEY) errors.push('VITE_SUPABASE_PUBLISHABLE_KEY is missing');
  else if (!validPublicKey(env.VITE_SUPABASE_PUBLISHABLE_KEY)) errors.push('VITE_SUPABASE_PUBLISHABLE_KEY must be a public publishable key or legacy anon JWT');

  if (!validBasePath(env.VITE_BASE_PATH, env.GITHUB_REPOSITORY)) errors.push('VITE_BASE_PATH must be / or /repository-name/');
  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = validateDeploymentConfig(process.env);
  if (result.ok) console.log('PASS: deployment public configuration is valid.');
  else {
    for (const error of result.errors) console.error(`FAIL: ${error}`);
    process.exitCode = 1;
  }
}
