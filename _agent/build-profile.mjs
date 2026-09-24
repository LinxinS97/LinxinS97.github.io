import { readFile, writeFile } from 'node:fs/promises';
const profile = await readFile(new URL('../_includes/profile.md', import.meta.url), 'utf8');
// Use rendered anchors so sidebar/header links and future template links are covered too.
// Build Jekyll first; fail rather than silently deploy an incomplete catalog.
const page = await readFile(new URL('../_site/index.html', import.meta.url), 'utf8');
import { linkCatalog } from './links.mjs';
const pageLinks = linkCatalog(profile, page);
const escape = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const pageHTML = pageLinks.map(link => '<a href="' + escape(link.url) + '">' + escape(link.title) + '</a>').join('\n');
await writeFile(new URL('./profile.generated.mjs', import.meta.url), 'export default ' + JSON.stringify(profile) + ';\nexport const pageHTML = ' + JSON.stringify(pageHTML) + ';\n');
console.log('Built authoritative profile and ' + pageLinks.length + ' listed links.');
