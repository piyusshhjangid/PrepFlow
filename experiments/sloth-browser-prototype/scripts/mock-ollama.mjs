// MOCK Ollama-compatible server for testing the app's plumbing (proxy, adapter, UI) without a model.
// It is NOT Gemma and NOT a model: it builds "topics" from the first sentence of each paragraph and adds
// one deliberately fabricated quote. Never use its output as evidence of model quality.
//   node scripts/mock-ollama.mjs [port]      (default 11434)
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 11434);
const log = [];

function topicsFrom(prompt) {
  const m = /<<<MATERIAL (\w+)>>>\n([\s\S]*?)\n<<<END MATERIAL \1>>>/.exec(prompt);
  const material = m ? m[2] : '';
  const paras = material
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40);
  const topics = paras.slice(0, 8).map((p) => {
    const sentence = (/^(.{25,200}?[.!?])(\s|$)/.exec(p) ?? [null, p.slice(0, 120)])[1];
    const name = p
      .replace(/^(week|unit|section)\s*\d+\s*[-:.]\s*/i, '')
      .split(/[.:]/)[0]
      .split(/\s+/)
      .slice(0, 4)
      .join(' ');
    return {
      name,
      description: `Mock summary of ${name}.`,
      evidence: sentence,
      effort: 'medium',
      difficulty: 2,
      importance: 'high',
      prerequisites: [],
    };
  });
  topics.push({
    name: 'Invented topic',
    description: 'Mock: fabricated on purpose.',
    evidence: 'This sentence does not appear anywhere in the student material.',
    effort: 'short',
    difficulty: 1,
    importance: 'medium',
    prerequisites: [],
  });
  return { topics };
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    log.push(`${req.method} ${req.url}`);
    const json = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.url === '/api/tags')
      return json(200, {
        models: [
          {
            name: 'gemma4:e4b',
            digest: 'mock0123456789abcdef',
            details: { parameter_size: 'MOCK', quantization_level: 'none' },
          },
        ],
      });
    if (req.url === '/api/version') return json(200, { version: 'mock-0.0.0' });
    if (req.url === '/api/chat' && req.method === 'POST') {
      const r = JSON.parse(body);
      const user = r.messages.find((m) => m.role === 'user').content;
      return setTimeout(
        () =>
          json(200, {
            message: { role: 'assistant', content: JSON.stringify(topicsFrom(user)) },
            prompt_eval_count: 100,
            eval_count: 50,
            eval_duration: 1e9,
          }),
        400,
      );
    }
    if (req.url === '/__log') return json(200, log);
    json(404, { error: 'not found' });
  });
}).listen(port, '127.0.0.1', () =>
  console.log(`MOCK Ollama (not a model) on http://127.0.0.1:${port}`),
);
