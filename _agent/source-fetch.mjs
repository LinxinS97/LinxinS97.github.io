import { publicURL } from './links.mjs';

export function publicAddress(address) {
  if (address.includes(':')) {
    const prefix = parseInt(address.split(':')[0], 16);
    const second = parseInt(address.split(':')[1] || '0', 16);
    return prefix >= 0x2000 && prefix <= 0x3fff && !address.includes('.') &&
      !(prefix === 0x2001 && (second < 0x200 || second === 0xdb8)) && prefix !== 0x2002 && prefix !== 0x3fff;
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts;
  return a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) &&
    !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113);
}

// Worker adapter: check every redirect target's public DNS before requesting it.
export async function workerSourceFetch(value, options) {
  const url = publicURL(value);
  const records = await Promise.all(['A', 'AAAA'].map(async type => {
    const result = await fetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(url.hostname) + '&type=' + type,
      { headers: { Accept: 'application/dns-json' }, signal: options.signal });
    if (!result.ok) throw new Error('DNS unavailable.');
    const data = await result.json();
    return (data.Answer || []).filter(record => record.type === 1 || record.type === 28).map(record => record.data);
  }));
  if (!records.flat().length || !records.flat().every(publicAddress)) throw new Error('Non-public destination.');
  return fetch(url, options);
}
