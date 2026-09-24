import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns';
import { Readable } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { publicURL } from './links.mjs';
import { publicAddress } from './source-fetch.mjs';

// Validate and pin the DNS answer actually used by the socket (also on every redirect).
export async function localSourceFetch(value, options) {
  const url = publicURL(value);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      signal: options.signal, headers: options.headers,
      lookup(host, opts, callback) {
        lookup(host, { all: true }, (error, records) => {
          if (error || !records?.length || !records.every(record => publicAddress(record.address))) return callback(error || new Error('Non-public destination.'));
          if (opts.all) callback(null, records);
          else callback(null, records[0].address, records[0].family);
        });
      }
    }, response => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      let stream = response;
      const encoding = headers.get('content-encoding');
      const decompress = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress }[encoding];
      if (decompress) {
        stream = response.pipe(decompress());
        response.on('error', error => stream.destroy(error));
        stream.on('close', () => response.destroy());
        headers.delete('content-encoding'); headers.delete('content-length');
      }
      const noBody = [204, 205, 304].includes(response.statusCode);
      if (noBody) response.resume();
      resolve(new Response(noBody ? null : Readable.toWeb(stream), { status: response.statusCode, headers }));
    });
    request.on('error', reject);
  });
}
