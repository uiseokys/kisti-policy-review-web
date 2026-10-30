import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Synthetic browser key and JWT fixtures; neither is accepted by a Supabase server.
const publishable = `sb_publishable_${'A'.repeat(32)}`;
const jwt = (role: string) => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role, iss: 'supabase' })).toString('base64url'),
  'synthetic_signature_only'
].join('.');

// The production validator is a plain Node ESM script.
const { validateDeploymentConfig } = await import('../scripts/check-deployment.mjs' as string) as {
  validateDeploymentConfig: (env: Record<string, string | undefined>) => { ok: boolean; errors: string[] };
};

const valid = {
  VITE_SUPABASE_URL: 'https://synthetic-project.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: publishable,
  VITE_BASE_PATH: '/kisti-policy-review-web/',
  GITHUB_REPOSITORY: 'example/kisti-policy-review-web'
};

describe('deployment preflight', () => {
  it('accepts a public publishable key and repository base path', () => {
    expect(validateDeploymentConfig(valid)).toEqual({ ok: true, errors: [] });
  });

  it('accepts a synthetic legacy anon JWT and root base path', () => {
    expect(validateDeploymentConfig({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: jwt('anon'), VITE_BASE_PATH: '/' }).ok).toBe(true);
  });

  it('names missing public configuration without showing values', () => {
    const result = validateDeploymentConfig({ VITE_BASE_PATH: '/' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('VITE_SUPABASE_URL');
    expect(result.errors.join(' ')).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
  });

  it.each([
    ['HTTP', 'http://synthetic-project.supabase.co'],
    ['credentials', 'https://user:pass@synthetic-project.supabase.co'],
    ['query', 'https://synthetic-project.supabase.co?token=x'],
    ['empty query', 'https://synthetic-project.supabase.co?'],
    ['fragment', 'https://synthetic-project.supabase.co/#x'],
    ['empty fragment', 'https://synthetic-project.supabase.co#'],
    ['local', 'https://localhost'],
    ['placeholder', 'https://example.com']
  ])('rejects an unsafe %s URL', (_name, url) => {
    expect(validateDeploymentConfig({ ...valid, VITE_SUPABASE_URL: url }).ok).toBe(false);
  });

  it.each([
    ['secret', `sb_secret_${'A'.repeat(32)}`],
    ['service JWT', jwt('service_role')],
    ['malformed JWT', 'eyJ.invalid.signature'],
    ['placeholder', 'YOUR_SUPABASE_ANON_KEY'],
    ['short publishable', 'sb_publishable_demo']
  ])('rejects a %s key', (_name, key) => {
    expect(validateDeploymentConfig({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: key }).ok).toBe(false);
  });

  it.each(['/repo/../other/', '/repo//', '//evil/', 'https://evil/', '/%2e%2e/', '/other/'])('rejects an unsafe or mismatched base path %s', base => {
    expect(validateDeploymentConfig({ ...valid, VITE_BASE_PATH: base }).ok).toBe(false);
  });

  it('CLI exits nonzero on missing config and does not print configured values', () => {
    const script = resolve('scripts/check-deployment.mjs');
    const marker = 'DO_NOT_PRINT_THIS_VALUE';
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { VITE_SUPABASE_URL: marker, VITE_BASE_PATH: '/' }
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('VITE_SUPABASE_URL');
    expect(result.stderr).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
    expect(result.stderr + result.stdout).not.toContain(marker);
  });
});
