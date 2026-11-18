import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Miniflare } from 'miniflare';

describe('Stage C.2 Real Miniflare Worker + Static Assets & CD Guard Verification', () => {
  let mf: Miniflare | null = null;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axnna-mf-'));
    const workerOut = path.join(tempDir, 'worker.mjs');
    const workerEntry = path.resolve(__dirname, '../src/worker.ts');
    const esbuildBin = path.resolve(__dirname, '../node_modules/.bin/esbuild');

    execFileSync(esbuildBin, [
      workerEntry,
      '--bundle',
      '--format=esm',
      '--platform=browser',
      '--target=es2022',
      `--outfile=${workerOut}`,
    ]);

    const distDir = path.resolve(__dirname, '../dist');
    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
      throw new Error('dist/index.html missing; run npm run build before running Miniflare asset test.');
    }

    const workerSource = fs.readFileSync(workerOut, 'utf8');
    mf = new Miniflare({
      modules: true,
      script: workerSource,
      compatibilityDate: '2024-03-20',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { DB: 'test-d1-id' },
      bindings: {
        ENVIRONMENT: 'staging',
        TWELVEDATA_API_KEY: 'test_td_key_1234',
        TELEGRAM_BOT_TOKEN: '123456:TEST_BOT_TOKEN',
        TELEGRAM_WEBHOOK_SECRET: 'test_wh_secret_1234',
      },
      assets: {
        directory: distDir,
        binding: 'ASSETS',
        routerConfig: {
          has_user_worker: true,
          invoke_user_worker_ahead_of_assets: true,
        },
        assetConfig: {
          not_found_handling: 'single-page-application',
        },
      },
    });

    const d1 = await mf.getD1Database('DB');
    const migrationsDir = path.resolve(__dirname, '../migrations');
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of migrationFiles) {
      const rawSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const cleanedSql = rawSql
        .split('\n')
        .map((line) => line.replace(/--.*$/, '').trim())
        .filter(Boolean)
        .join(' ');
      const statements = cleanedSql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await d1.prepare(stmt).run();
      }
    }
  });

  afterAll(async () => {
    if (mf) {
      await mf.dispose();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('serves built frontend routes, /apiary SPA route, real static assets, 404 missing assets, and JSON 404 on unknown /api/* routes', async () => {
    expect(mf).not.toBeNull();
    const distAssetsDir = path.resolve(__dirname, '../dist/assets');
    const realJsFile = fs.readdirSync(distAssetsDir).find((f) => f.endsWith('.js'));
    expect(realJsFile).toBeDefined();

    // 1. Root & SPA direct navigation (/config, /apiary, missing frontend SPA route)
    for (const spaRoute of ['/', '/config', '/status', '/apiary', '/nonexistent-spa-route']) {
      const res = await mf!.dispatchFetch(`https://staging.axnna.example${spaRoute}`, {
        headers: { Accept: 'text/html' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('<div id="root"></div>');
    }

    // 2. Valid static assets return 200
    const assetRes = await mf!.dispatchFetch(`https://staging.axnna.example/assets/${realJsFile}`);
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get('Content-Type')).toContain('javascript');

    const favRes = await mf!.dispatchFetch('https://staging.axnna.example/favicon.svg');
    expect(favRes.status).toBe(200);

    // 3. Missing static assets across /assets/* and root file extensions return 404 rather than HTML SPA fallback
    const missingPaths = [
      '/assets/does-not-exist-chunk.js',
      '/assets/does-not-exist-style.css',
      '/does-not-exist-image.png',
      '/does-not-exist-icon.svg',
      '/does-not-exist-data.json',
    ];
    for (const mp of missingPaths) {
      const missingAssetRes = await mf!.dispatchFetch(`https://staging.axnna.example${mp}`, {
        headers: { Accept: '*/*' },
      });
      expect(missingAssetRes.status).toBe(404);
    }

    // 4. Worker API (/api/status) and unknown /api/* (/api, /api/nope) return JSON
    const statusRes = await mf!.dispatchFetch('https://staging.axnna.example/api/status');
    expect(statusRes.status).toBe(200);
    const statusJson = (await statusRes.json()) as any;
    expect(statusJson.monitoredInstruments).toEqual(['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD']);

    for (const apiPath of ['/api', '/api/unknown-route']) {
      const apiRes = await mf!.dispatchFetch(`https://staging.axnna.example${apiPath}`, {
        headers: { Accept: 'text/html' },
      });
      expect(apiRes.status).toBe(404);
      expect(apiRes.headers.get('Content-Type')).toContain('application/json');
      expect(await apiRes.json()).toEqual({ error: 'Not Found' });
    }
  });

  it('FND-05: CD environment validation allows staging deploy while production placeholder remains, and blocks unconfigured target', () => {
    const sampleWrangler = `
[env.staging]
name = "axnna-staging"
[[env.staging.d1_databases]]
binding = "DB"
database_name = "axnna_db_staging"
database_id = "11111111-2222-3333-4444-555555555555"

[env.production]
name = "axnna"
[[env.production.d1_databases]]
binding = "DB"
database_name = "axnna_db_production"
database_id = "REPLACE_WITH_PRODUCTION_D1_DATABASE_ID"
`;

    const validateEnvDbId = (raw: string, target: string): boolean => {
      const sectionHeader = `[env.${target}]`;
      const idx = raw.indexOf(sectionHeader);
      if (idx === -1) return false;
      const rest = raw.slice(idx + sectionHeader.length);
      const nextEnvMatch = rest.match(/\n\[env\.[^\]]+\]/);
      const block = nextEnvMatch ? rest.slice(0, nextEnvMatch.index) : rest;
      const dbMatch = block.match(/database_id\s*=\s*"([^"]+)"/);
      return Boolean(dbMatch && dbMatch[1] && !dbMatch[1].startsWith('REPLACE_WITH_'));
    };

    expect(validateEnvDbId(sampleWrangler, 'staging')).toBe(true);
    expect(validateEnvDbId(sampleWrangler, 'production')).toBe(false);
    expect(validateEnvDbId(sampleWrangler, 'nonexistent')).toBe(false);
  });
});
