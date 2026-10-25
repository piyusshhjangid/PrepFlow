// Static check: lists every http(s) URL string inside the production bundle and fails on anything that is
// not on the allowlist. This does NOT prove the app makes no network calls at runtime (see docs/privacy.md
// for the runtime check); it catches an accidentally added CDN, font host, analytics or API URL.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = [
  /^https?:\/\/www\.w3\.org\//, // XML/SVG namespaces, not requests
  /^https?:\/\/react\.dev\//, // React's error-message help links (text only)
  /^https?:\/\/(?:www\.)?reactjs\.org\//,
  /^https?:\/\/github\.com\/mozilla\/pdf\.js/, // pdf.js documentation links (text only)
  /^https?:\/\/mozilla\.github\.io\/pdf\.js\//,
  /^https?:\/\/localhost[:/]/,
  /^https?:\/\/127\.0\.0\.1[:/]/,
  /^https?:\/\/example\.com/,
  /^https?:\/\/mathiasbynens\.be\//, // punycode/regex comments in dependencies
  /^https?:\/\/(?:www\.)?adobe\.com\//, // PDF spec references in pdf.js
  /^https?:\/\/(?:www\.)?unicode\.org\//,
  /^https?:\/\/(?:www\.)?iso\.org\//,
  /^https?:\/\/(?:www\.)?fontforge\.org\//,
  /^https?:\/\/(?:www\.)?apache\.org\//,
  // Verified by reading the bundle: identifiers and parser inputs, never fetched.
  /^https?:\/\/json-schema\.org\//, // JSON Schema meta-schema ids inside zod
  /^https?:\/\/(?:www\.)?xfa\.org\//, // XFA XML namespaces inside pdf.js
  /^https?:\/\/ns\.adobe\.com\//, // XMP/XDP XML namespaces inside pdf.js
  /^https:\/\/foo\.bar$/, // pdf.js uses it only as a base for new URL(relative, base)
  /^http:\/\/\[?\$\{e\}\]?$/, // template fragments fed to URL validators, not requests
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const dist = new URL('../dist', import.meta.url).pathname;
let files;
try {
  files = walk(dist).filter((f) => /\.(js|mjs|css|html)$/.test(f));
} catch {
  console.error('dist/ not found. Run "npm run build" first.');
  process.exit(2);
}

const found = new Map();
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
    const url = m[0].replace(/[.,;]+$/, '');
    if (ALLOWED.some((re) => re.test(url))) continue;
    found.set(url, (found.get(url) ?? new Set()).add(file.replace(dist, 'dist')));
  }
}

if (found.size > 0) {
  console.error('Unexpected external URLs in the production bundle:');
  for (const [url, where] of found) console.error(`  ${url}  (${[...where].join(', ')})`);
  process.exit(1);
}
console.log(`OK: no unexpected external URLs in ${files.length} built files.`);
