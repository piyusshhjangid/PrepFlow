# Privacy and offline behaviour

## Where your material goes

| Place                                                       | What                                                                             | Who can see it                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Browser memory and `localStorage` (key `prepflow-sloth:v1`) | Material text, topics, progress                                                  | Anyone using this browser profile; browser extensions with site access                         |
| Vite dev/preview server                                     | Forwards `/ollama/*` to Ollama; does not log bodies in its default configuration | Whoever runs it (normally you)                                                                 |
| Ollama process (`OLLAMA_URL`, default `127.0.0.1:11434`)    | Each chunk of material, to run the model                                         | Whoever runs it. If you point `OLLAMA_URL` at another machine, that machine sees your material |
| Anywhere else                                               | Nothing, by design                                                               | n/a                                                                                            |

The app contains no analytics, telemetry, remote fonts, CDN scripts or API keys.

## Verified

- `npm run check:external` scans the production bundle for URLs and fails on anything not allowlisted. The remaining allowlisted strings are XML/JSON-schema namespace identifiers and URL-parser inputs inside zod and pdf.js (each checked by reading the bundle; reasons are in `scripts/check-external-urls.mjs`). This is a **static** check of strings, not proof of runtime behaviour.
- The only runtime request path in the code is same-origin `/ollama/*` (`src/ui/runtime.ts`).
- In real Chromium (Playwright) against the mock server, a full analysis made 6 requests, **all to the app's own origin**, and model traffic used only `/ollama/api/tags` and `/ollama/api/chat`. "Start over" removed the material, topics and progress from `localStorage`. Output: `docs/submission/browser-check-output.txt`. Reproduce with `npm run check:browser`.
- With Ollama down the proxy returns 502 and the app says so, keeps your material, and still offers outline mode and the sample.

## Not verified yet (do this before claiming it)

- **Runtime network behaviour with a real Ollama.** The browser check used a mock server; repeat once by hand (DevTools → Network) with real Gemma.
- **Offline end-to-end.** Procedure: (1) `ollama pull` the model and run `npm ci` and `npm run build` while online; (2) start Ollama and `npm start`; (3) disable networking (turn off Wi-Fi and unplug Ethernet, or use airplane mode); (4) in the browser open http://127.0.0.1:4173, load the sample from `eval/samples/`, run an analysis, complete a task; (5) confirm the plan appears and nothing failed; (6) record the machine, model, time, and any errors in `docs/evaluation.md`. If any step fails, do not claim offline operation.
- **Ollama's own telemetry/update checks**: this app does not control them; check Ollama's documentation and settings for your version.

## Honest caveats

- "Local model" does not make everything private. Anything else on the machine that reads `localStorage` or the network can see the same data.
- A hosted Gemma route is **not implemented**. If you add one, say that your material then leaves the machine.
- `localStorage` is not encrypted and is not backed up. "Start over" deletes it.
