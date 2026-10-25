# PrepFlow Sloth browser prototype

This directory preserves the standalone browser-only Sloth version and its tests, evaluation materials, demo assets, and documentation from the `upgrade/gemma-evidence-eval` branch.

It is an experimental reference app, not the production PrepFlow application. It has no Express API or PostgreSQL database. The supported full-stack application remains at the repository root (`apps/web`, `apps/api`, `packages/shared`). The prototype's evaluation reports measure the prototype and must not be represented as measurements of the full-stack application.

To run the prototype independently, use Node.js 22.22.2+, then run `npm ci`, `npm run eval:offline`, and `npm run dev` from this directory. A real-model evaluation requires Ollama and the model noted in `docs/evaluation.md`.

The original branch README is retained as [README.prototype.md](README.prototype.md) for reference. Its challenge dates, branch links, and submission wording are historical and are not claims about the current full-stack repository.
