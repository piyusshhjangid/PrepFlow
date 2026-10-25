// Real-browser check of the built app against the MOCK Ollama server (scripts/mock-ollama.mjs).
// It verifies plumbing and behaviour, NOT model quality. Requires Playwright with Chromium, which is not a
// project dependency:   npm i --no-save playwright && npx playwright install chromium
//   npm run build && node scripts/mock-ollama.mjs & npx vite preview --port 4173 & node scripts/browser-check.mjs
import { readFileSync } from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    // Fall back to a globally installed Playwright (PLAYWRIGHT_PATH, or `npm root -g`).
    const { createRequire } = await import('node:module');
    const { execSync } = await import('node:child_process');
    const root = process.env.PLAYWRIGHT_PATH ?? execSync('npm root -g').toString().trim();
    ({ chromium } = createRequire(`${root}/`)('playwright'));
  } catch {}
}
if (!chromium) {
  console.error(
    'Playwright is not installed. Run: npm i --no-save playwright && npx playwright install chromium',
  );
  process.exit(2);
}
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const SAMPLE = readFileSync(
  new URL('../eval/samples/01-structured-syllabus.txt', import.meta.url),
  'utf8',
);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const requests = [];
const errors = [];
page.on('request', (r) => requests.push(r.url()));
page.on('pageerror', (e) => errors.push(String(e)));
// The 502s are the runtime-down scenario this script forces on purpose.
page.on(
  'console',
  (m) => m.type() === 'error' && !/status of 502/.test(m.text()) && errors.push(m.text()),
);
// Anything that is not this app's own origin is refused, so a hidden external call would fail loudly.
const origin = new URL(BASE).origin;
await ctx.route('**/*', (route) =>
  route.request().url().startsWith(origin) ||
  route.request().url().startsWith('data:') ||
  route.request().url().startsWith('blob:')
    ? route.continue()
    : route.abort(),
);

await page.goto(BASE);
await page.waitForSelector('text=Ollama is running');
check(
  'status chip shows the runtime is up and the model is installed',
  (await page.locator('.model-status.tone-ok').count()) === 1,
);

await page.getByLabel(/Paste your syllabus/).fill(SAMPLE);
await page.click('button:has-text("Find my topics")');
await page.waitForSelector('h2:has-text("Your next step")', { timeout: 20000 });
check('analysis completes and shows the next step', true);
const focused = await page.evaluate(() => document.activeElement?.textContent);
check(
  'focus moves to "Your next step" after analysis',
  focused === 'Your next step',
  String(focused),
);
check(
  'the fabricated mock topic is held back, not planned',
  (await page.locator('text=Held back: no matching passage').count()) > 0,
);

const external = requests.filter(
  (u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'),
);
check(
  'no request left the app origin',
  external.length === 0,
  external.join(', ') || `${requests.length} requests`,
);
const paths = [
  ...new Set(requests.filter((u) => u.includes('/ollama/')).map((u) => new URL(u).pathname)),
].sort();
check('model traffic only uses the same-origin /ollama proxy', paths.length > 0, paths.join(', '));

await page.click('button:has-text("Mark done")');
const before = await page.locator('.summary p').first().innerText();
await page.reload();
await page.waitForSelector('h2:has-text("Your next step")');
const after = await page.locator('.summary p').first().innerText();
check('progress survives a reload', before === after, after);

for (const [w, h] of [
  [1280, 900],
  [768, 1024],
  [430, 932],
  [390, 844],
]) {
  await page.setViewportSize({ width: w, height: h });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  check(`no horizontal overflow at ${w}px`, !overflow);
}
await page.setViewportSize({ width: 1280, height: 900 });

page.once('dialog', (d) => d.accept());
await page.click('button:has-text("Start over")');
const stored = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('prepflow-sloth:v1') ?? '{}'),
);
check(
  '"Start over" removes material, topics and progress from storage',
  stored.material?.text === '' &&
    stored.topics?.length === 0 &&
    Object.keys(stored.progress ?? {}).length === 0,
);

// Recovery: runtime down -> clear message -> outline mode still gives a plan.
await ctx.route('**/ollama/**', (route) => route.fulfill({ status: 502, body: 'down' }));
await page.reload();
await page.getByLabel(/Paste your syllabus/).fill(SAMPLE);
await page.click('button:has-text("Find my topics")');
await page.waitForSelector('text=Could not reach the local model runtime');
check(
  'Ollama down: clear error, material kept',
  (await page.getByLabel(/Paste your syllabus/).inputValue()) === SAMPLE,
);
await page.click('button:has-text("Outline mode (no AI)")');
await page.waitForSelector('h2:has-text("Your next step")');
check(
  'Ollama down: outline mode still produces a plan, labelled as no AI',
  (await page.locator('text=Outline mode (no AI).').count()) > 0,
);

// Sample mode with no runtime at all.
await page.click('button:has-text("Start over")').catch(() => undefined);
page.once('dialog', (d) => d.accept());
await page.click('button:has-text("Start over")').catch(() => undefined);
await page.reload();
await page.click('button:has-text("Try the sample")');
await page.waitForSelector('text=Sample data.');
check(
  'sample mode works with the runtime down and is labelled hand-written',
  (await page.locator('text=not produced by Gemma').count()) > 0,
);

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
