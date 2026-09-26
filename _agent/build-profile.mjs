import { readFile, writeFile } from 'node:fs/promises';
import { profileSnapshot } from './profile-snapshot.mjs';
const profile = await readFile(new URL('../_includes/profile.md', import.meta.url), 'utf8');
// Use rendered anchors so sidebar/header links and future template links are covered too.
// Build Jekyll first; fail rather than silently deploy an incomplete catalog.
const page = await readFile(new URL('../_site/index.html', import.meta.url), 'utf8');
const snapshot = await profileSnapshot(page);
if (snapshot.PROFILE.trim() !== profile.trim()) throw new Error('The rendered page is stale. Rebuild Jekyll before deploying the agent.');
await writeFile(new URL('./profile.generated.mjs', import.meta.url), 'export default ' + JSON.stringify(snapshot.PROFILE) + ';\nexport const pageHTML = ' + JSON.stringify(snapshot.PAGE_HTML) + ';\nexport const profileVersion = ' + JSON.stringify(snapshot.PROFILE_VERSION) + ';\n');
console.log('Built server profile snapshot ' + snapshot.PROFILE_VERSION.slice(0, 12) + ' from the rendered page.');
