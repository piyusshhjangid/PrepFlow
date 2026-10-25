# Demo script (2 to 3 minutes)

Three versions. Record **Version B** (real Gemma) if you can run it; it is the only one that shows the category claim. Version A is the safe backup. Never present A as Gemma output.

## Version A: no model (sample mode)

1. Open the app, click **Try the sample (no model needed)**.
2. Point at the **SAMPLE DATA** banner: "These proposals are hand-written, run through the real checks."
3. Show the topic held back (fabricated quote), the topic with the "weak link" flag, and the topic whose "high" was shown as medium. Open a **Why is it here?** panel and read two tagged lines.
4. Show **Your next step** and its "Why this, and why now?" panel.
5. Lower daily minutes to show the overflow banner; click the suggestion.

## Version B: real Gemma (this is the main script below)

## Version C: recovery when Ollama is down

Stop Ollama, press **Find my topics**: the error says what to do and keeps your material. Press **Outline mode (no AI)**: a plan appears, labelled "no AI". Say this out loud; it is the point.

**Status: not yet recorded. Written against the code; the real-model steps have not been run by me.** Follow the recording checklist in `submission/recording-checklist.md`, and edit the narration to match what actually happens on your machine.

## Setup (off camera)

```bash
ollama pull gemma4:e4b          # once, online
npm ci && npm run build
ollama serve                    # skip if Ollama already runs as a service
npm start                       # http://127.0.0.1:4173
```

Have `eval/samples/01-structured-syllabus.txt` open in an editor. Clear the app with "Start over" so the first screen is empty.

## Script

| Time | On screen                                                                                         | Say                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | Empty app, "How it works" card                                                                    | "Before a student studies anything they split the syllabus into topics, decide what matters, and guess how long it will take. Then a bad day wrecks the plan and they do it all again." |
| 0:15 | Paste sample 01. Set exam date 6 days out, 120 min/day                                            | "A database syllabus, an exam in six days, two hours a day."                                                                                                                            |
| 0:30 | Header chip shows Ollama running and the model installed; press **Find my topics**                | "Gemma runs locally through Ollama. The status line says which model is reading which part."                                                                                            |
| 0:45 | Topics appear; open one **Source passage**                                                        | "Every topic must carry a quote copied from my syllabus, and the app checks it is really there. This one is, with the original wording."                                                |
| 1:05 | Point at any topic under "Held back" (if the model produced one; if not, say so and skip)         | "If the model invents or paraphrases a quote, the topic is held back, not planned."                                                                                                     |
| 1:20 | **Your next step** card                                                                           | "Study this, for this long, because it is high priority and two other topics build on it. Here is the passage it came from."                                                            |
| 1:40 | Lower daily time to 45 min                                                                        | "Now I only have 45 minutes a day." Show the **Not everything fits** banner. "It says exactly what does not fit, and what daily time would fit everything. It never pretends."          |
| 2:00 | Click the suggested time, banner disappears                                                       | "One click applies it."                                                                                                                                                                 |
| 2:10 | **Mark done** on the next step; progress bar moves; open schedule to show a later **Revise** task | "The plan is rebuilt from today every time. Miss a day and it just slides forward. Revision is scheduled one and three days after I finish a topic."                                    |
| 2:30 | Reload the page: progress is still there. Click **Copy Markdown**                                 | "Everything is in my browser; the only network requests are to my own machine." (Say this only after you have looked at the Network tab with the real run.)                             |
| 2:45 | Back to the diagram in the README                                                                 | "Gemma finds topics. Plain tested code does everything else: priority, capacity, scheduling, revision."                                                                                 |

## Expected behaviour (what the code guarantees)

- The exam day is never a study day; no task is ever dated on or after it.
- Daily load never exceeds the chosen minutes; sessions never exceed the session length.
- A topic is never scheduled before its (active) prerequisites are fully studied.
- If everything cannot fit, the banner appears and lists what is left out.

## What you cannot promise on camera until you have seen it

How many topics Gemma finds, how long analysis takes on your laptop, and whether any topic is held back. Show what actually happens.
