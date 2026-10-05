import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const levels = ['low', 'moderate', 'high', 'critical'];
const idPattern = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

// Pure decision logic: no npm, filesystem, clock, or logging dependencies.
export function evaluateAudit(audit, allowlist, today, auditLevel = 'moderate') {
  const result = { ok: false, errors: [], warnings: [], findings: [], allowed: [] };
  if (!levels.includes(auditLevel)) result.errors.push(`Invalid audit-level: ${auditLevel}`);
  if (!validDate(today)) result.errors.push('Invalid today date; expected YYYY-MM-DD.');
  if (!audit || typeof audit !== 'object' || Array.isArray(audit) || 'error' in audit) {
    result.errors.push(`npm audit returned an error: ${JSON.stringify(audit?.error ?? audit)}`);
  } else if (!audit.vulnerabilities || typeof audit.vulnerabilities !== 'object' || Array.isArray(audit.vulnerabilities)) {
    result.errors.push('Unexpected npm audit shape: expected vulnerabilities[*].via[].');
  }
  if (!Array.isArray(allowlist)) {
    result.errors.push('Malformed allowlist: expected a JSON array.');
  } else {
    for (const [index, entry] of allowlist.entries()) {
      if (!entry || !idPattern.test(entry.id) || !validDate(entry.expires) ||
          typeof entry.reason !== 'string' || !entry.reason.trim()) {
        result.errors.push(`Malformed allowlist entry ${index + 1}: expected id (GHSA-...), expires (YYYY-MM-DD), and nonempty reason.`);
      }
    }
  }
  if (result.errors.length) return result;

  const reported = new Set();
  const findings = new Map();
  for (const [pkg, vulnerability] of Object.entries(audit.vulnerabilities)) {
    if (!vulnerability || !Array.isArray(vulnerability.via)) {
      result.errors.push(`Unexpected npm audit shape for ${pkg}: expected via[].`);
      continue;
    }
    for (const advisory of vulnerability.via) {
      if (typeof advisory === 'string') continue;
      const id = typeof advisory?.url === 'string' ? advisory.url.split('/').at(-1) : '';
      if (!idPattern.test(id) || !levels.includes(advisory?.severity)) {
        result.errors.push(`Malformed npm advisory for ${pkg}: expected a GHSA URL and known severity.`);
        continue;
      }
      reported.add(id);
      if (levels.indexOf(advisory.severity) < levels.indexOf(auditLevel)) continue;
      const finding = { id, package: advisory.name ?? pkg, severity: advisory.severity, title: advisory.title, url: advisory.url };
      // Keep the highest severity if the same id appears more than once.
      if (!findings.has(id) || levels.indexOf(findings.get(id).severity) < levels.indexOf(finding.severity)) findings.set(id, finding);
    }
  }
  for (const entry of allowlist) {
    if (entry.expires < today) {
      result.errors.push(`Allowlist entry ${entry.id} expired on ${entry.expires}; check whether a patch exists, then renew or remove it.`);
    } else if (!reported.has(entry.id)) {
      result.warnings.push(`Allowlist entry ${entry.id} is no longer reported; remove it.`);
    }
  }
  for (const finding of findings.values()) {
    const entry = allowlist.find(entry => entry.id === finding.id && entry.expires >= today);
    if (entry) result.allowed.push({ ...finding, expires: entry.expires });
    else result.findings.push(finding);
  }
  result.ok = !result.errors.length && !result.findings.length;
  return result;
}

// Escape untrusted text before writing GitHub workflow annotations.
const escape = value => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

function main() {
  try {
    let allowlist = [];
    try {
      allowlist = JSON.parse(readFileSync(process.env.AUDIT_ALLOWLIST || '.audit-allowlist.json', 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot read allowlist: ${error.message}`);
    }
    const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (run.error || run.signal) throw new Error(`Cannot run npm audit: ${run.error?.message ?? run.signal}`);
    let audit;
    try { audit = JSON.parse(run.stdout); }
    catch { throw new Error('Cannot parse npm audit JSON output.'); }
    const result = evaluateAudit(audit, allowlist, new Date().toISOString().slice(0, 10), process.env.AUDIT_LEVEL || 'moderate');
    for (const message of result.errors) console.error(`::error::${escape(message)}`);
    for (const message of result.warnings) console.log(`::warning::${escape(message)}`);
    for (const finding of result.findings) console.error(`::error::${escape(`${finding.id} | ${finding.package} | ${finding.severity} | ${finding.title} | ${finding.url}`)}`);
    for (const finding of result.allowed) console.log(`Allowlisted: ${escape(finding.id)} | ${escape(finding.package)} | expires ${finding.expires}`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`::error::${escape(error.message)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
