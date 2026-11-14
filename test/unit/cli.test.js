import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const binPath = resolve(process.cwd(), 'bin/condo-price.js');

test('CLI condo-price --help outputs usage', async () => {
  const { stdout } = await execFileAsync('node', [binPath, '--help']);
  assert.ok(stdout.includes('condo-price'));
  assert.ok(stdout.includes('pull'));
  assert.ok(stdout.includes('benchmark'));
  assert.ok(stdout.includes('seed-annual'));
  assert.ok(stdout.includes('guardrails'));
});

test('CLI condo-price seed-annual seeds 365 baselines', async () => {
  const { stdout } = await execFileAsync('node', [binPath, 'seed-annual', '--json']);
  const res = JSON.parse(stdout);
  assert.equal(res.success, true);
  assert.equal(res.count, 365);
});

test('CLI condo-price guardrails gets and updates floor/ceiling with NO undercuts', async () => {
  const { stdout: getOut } = await execFileAsync('node', [binPath, 'guardrails', '--json']);
  const initial = JSON.parse(getOut);
  assert.equal(initial.floor_price, 2800);
  assert.equal(initial.ceiling_price, 8500);
  assert.equal(initial.undercut, undefined);
  assert.equal(initial.discount, undefined);
});

test('CLI condo-price benchmark computes recommendation without undercuts', async () => {
  const { stdout } = await execFileAsync('node', [binPath, 'benchmark', '--date', '2026-12-25', '--json']);
  const quote = JSON.parse(stdout);
  assert.equal(quote.date, '2026-12-25');
  assert.equal(quote.horizon, 'PEAK');
  assert.ok(quote.recommended_price >= 2800 && quote.recommended_price <= 8500);
  assert.equal(quote.undercut, undefined);
});
