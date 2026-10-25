# Recording and manual verification checklist

Items below are **not** done unless ticked. The automatic Chromium check (`npm run check:browser`, 16/16 against a mock) covers overflow at 4 widths, focus after analysis and same-origin requests; the manual items below are what it cannot see. Tick items as you do them; if something fails, fix it or leave the claim out.

## Real-model run

- [ ] `ollama pull gemma4:e4b` (and optionally `gemma4:e2b`) succeeded
- [ ] `npm run eval:smoke` worked (plumbing)
- [ ] `npm run eval -- --model gemma4:e4b --runs 3` finished; paste `eval/results/live-latest.md` into `docs/evaluation.md` (add nothing the file does not say)
- [ ] Noted hardware (CPU, RAM, GPU) and seconds per sample

## Real browser, layouts

- [ ] 1440 px and 1280 px wide: no overflow, next-step card readable
- [ ] 768 px
- [ ] 430 px and 390 px (devtools device mode or a phone): buttons full width, no horizontal scroll, date input usable
- [ ] Dark mode (OS setting): text readable, status colours distinguishable
- [ ] Browser zoom 200%

## Keyboard and screen reader

- [ ] Tab order: header status → exam fields → material → model → "Find my topics"
- [ ] Every control has a visible focus ring
- [ ] After analysis, focus lands on "Your next step"
- [ ] Progress messages are announced (screen reader or at least inspect `aria-live` regions)
- [ ] Errors are announced and tied to their field

## Privacy / offline (see docs/privacy.md)

- [ ] Network tab during an analysis shows only `localhost` requests
- [ ] Offline test: networking disabled, analysis and plan still work (record the result either way)

## Failure paths

- [ ] Stop Ollama → "Could not reach the local model runtime", text preserved
- [ ] Use a model name you have not pulled → shows the exact `ollama pull` command
- [ ] Upload a scanned PDF (or an image-only PDF) → "No readable text found"
- [ ] Upload a `.txt` renamed to `.pdf` → clear error
- [ ] Reload mid-analysis → material still there, can re-run

## Capture

- [ ] Screenshots from the real app (empty state, topics with evidence, next step, overflow banner, mobile)
- [ ] Screen recording following `docs/demo-script.md`; upload and use that link in the article

## Submission (owner only)

- [ ] Ask the organisers about eligibility given PrepFlow (see `docs/eligibility.md`); keep the reply
- [ ] Confirm the earlier PrepFlow repository's earliest commit and commits during 19-25 Oct; the current evidence and open eligibility question are in `docs/eligibility.md`
- [ ] Push the repository public with history intact; put the link in the post
- [ ] Record the demo (Version B, or A plus C if Gemma cannot run); upload; link in the post
- [ ] Review the unpublished article for first-person accuracy, add a genuine demo and any screenshots, and confirm eligibility before publication; the required `hf26challenge` tag is set
- [ ] Publish before 25 Oct 11:59 PM PDT; submit on the challenge page
- [ ] Any commit after the deadline: list it in the README
