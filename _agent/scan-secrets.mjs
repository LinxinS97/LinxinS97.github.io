import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Never print matching text: diagnostics name only the file/object and rule.
const git = args => execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024 });
const failures = [];
const signatures = [
  ['OpenRouter key', /sk-or-v1-[a-zA-Z0-9]{32,}/],
  ['Resend key', /\bre_[a-zA-Z0-9_]{25,}\b/],
  ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{20,}/]
];
const exact = ['OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL', 'RESEND_API_KEY', 'VISITOR_HASH_SECRET']
  .filter(name => (process.env[name] || '').length >= 12).map(name => [name, Buffer.from(process.env[name])]);
function scan(label, bytes) {
  for (const [name, secret] of exact) if (bytes.includes(secret)) failures.push({ file: label, rule: 'configured ' + name });
  const text = bytes.toString('utf8');
  for (const [rule, pattern] of signatures) if (pattern.test(text)) failures.push({ file: label, rule });
}
function forbidden(path) {
  return /(?:^|\/)(?:\.env(?:\..*)?|\.dev\.vars.*|secrets[^/]*\.json)$|\.(?:sqlite(?:3)?(?:-.*)?|db(?:-.*)?|pem|key)$/i.test(path) && !path.endsWith('/.env.example') && path !== '.env.example';
}
const paths = [...new Set(git(['ls-files', '-co', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))];
for (const path of paths) {
  if (forbidden(path)) failures.push({ file: path, rule: 'private runtime file' });
  scan(path, readFileSync(path));
}
let blobCount = 0;
if (process.argv.includes('--history')) {
  const objects = git(['rev-list', '--objects', '--all']).toString().split('\n').filter(Boolean);
  const batch = execFileSync('git', ['cat-file', '--batch'], { input: objects.map(line => line.split(' ')[0]).join('\n') + '\n', maxBuffer: 256 * 1024 * 1024 });
  let cursor = 0;
  for (const object of objects) {
    const end = batch.indexOf(10, cursor);
    const [id, type, sizeText] = batch.subarray(cursor, end).toString().split(' ');
    const size = Number(sizeText);
    if (!Number.isInteger(size)) throw new Error('Invalid Git object stream.');
    const body = batch.subarray(end + 1, end + 1 + size);
    if (type === 'blob') { blobCount++; scan('history:' + id + ' ' + object.slice(id.length + 1), body); }
    cursor = end + 1 + size + 1;
  }
}
let siteFiles = 0;
if (process.argv.includes('--site')) {
  function walk(directory) {
    for (const entry of readdirSync(directory, {withFileTypes:true})) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        siteFiles++;
        const normalized = path.replaceAll('\\', '/');
        if (forbidden(normalized) || /\/(?:_agent|\.wrangler|node_modules)\//.test(normalized)) failures.push({file:normalized,rule:'private file in public site'});
        scan(normalized, readFileSync(path));
      }
    }
  }
  walk('_site');
}
console.log(JSON.stringify({ workingFiles: paths.length, historyBlobs: blobCount, siteFiles, findings: failures }, null, 2));
if (failures.length) process.exitCode = 1;
