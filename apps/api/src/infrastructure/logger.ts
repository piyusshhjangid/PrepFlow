/**
 * Minimal structured (JSON-lines) logger. Deliberately tiny: no dependency, no formatting
 * magic. Rule for callers: log metadata (operation, duration, provider, error category),
 * NEVER study content, uploaded text, prompts or secrets.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  if (process.env.NODE_ENV === 'test') return order.error + 1; // silent in tests
  return process.env.NODE_ENV === 'production' ? order.info : order.debug;
}

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (order[level] < threshold()) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...fields });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};
