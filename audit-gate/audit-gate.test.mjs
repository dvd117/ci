import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAudit } from './audit-gate.mjs';

const id = 'GHSA-vfj7-8cjw-p6xm';
const today = '2026-10-05';
const entry = { id, expires: '2026-11-05', reason: 'No patched release.' };
const advisory = { name: 'braces', severity: 'high', title: 'Test advisory', url: `https://github.com/advisories/${id}` };
const audit = (severity = 'high') => ({ vulnerabilities: { braces: { via: [{ ...advisory, severity }] } } });
const clean = { vulnerabilities: {} };
const decide = (data = audit(), list = [], level = 'moderate') => evaluateAudit(data, list, today, level);

test('clean audit passes', () => assert.equal(decide(clean).ok, true));
test('finding below threshold passes', () => assert.equal(decide(audit('low')).ok, true));
test('unlisted finding fails with advisory details', () => {
  const result = decide();
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings, [{ id, package: 'braces', severity: 'high', title: 'Test advisory', url: advisory.url }]);
});
test('listed unexpired finding passes and stays visible', () => {
  const result = decide(audit(), [entry]);
  assert.equal(result.ok, true);
  assert.equal(result.allowed[0].expires, entry.expires);
});
test('expired entry fails even on clean audit', () => {
  const result = decide(clean, [{ ...entry, expires: '2026-10-04' }]);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /expired.*check whether a patch exists.*renew or remove/);
});
test('stale entry warns but passes', () => {
  const result = decide(clean, [entry]);
  assert.equal(result.ok, true);
  assert.match(result.warnings[0], /no longer reported.*remove/);
});
test('malformed entry fails for each missing field', () => {
  for (const field of ['id', 'expires', 'reason']) {
    const bad = { ...entry };
    delete bad[field];
    assert.equal(decide(clean, [bad]).ok, false);
  }
});
test('malformed array, id, date, and reason fail', () => {
  for (const list of [{}, [null], [{ ...entry, id: 'braces' }], [{ ...entry, expires: '2026-02-30' }], [{ ...entry, reason: ' ' }]]) {
    assert.equal(decide(clean, list).ok, false);
  }
});
test('expiry today is still valid', () => assert.equal(decide(audit(), [{ ...entry, expires: today }]).ok, true));
test('dependency strings are skipped and ids deduplicated', () => {
  const data = audit();
  data.vulnerabilities.other = { via: ['braces', advisory] };
  assert.equal(decide(data).findings.length, 1);
});
test('reported advisory below threshold is not stale', () => {
  const result = decide(audit('low'), [entry]);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 0);
});
test('audit error key fails even if falsy', () => assert.equal(decide({ ...clean, error: null }).ok, false));
test('unexpected audit shape fails closed', () => {
  for (const data of [null, {}, { vulnerabilities: [] }, { vulnerabilities: { braces: {} } }]) assert.equal(decide(data).ok, false);
});
test('unknown threshold and malformed advisory fail closed', () => {
  assert.equal(decide(clean, [], 'info').ok, false);
  assert.equal(decide({ vulnerabilities: { braces: { via: [{}] } } }).ok, false);
});
