import { env } from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function serializeError(err) {
  if (!err) return undefined;
  return {
    name: err.name,
    message: err.message,
    code: err.code,
    ...(env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  };
}

export function createLogger(base = {}) {
  const emit = (level, msg, fields = {}) => {
    if (LEVELS[level] < LEVELS[env.LOG_LEVEL] || env.NODE_ENV === 'test') return;
    const { err, ...rest } = fields;
    const line = { level, time: new Date().toISOString(), msg, ...base, ...rest };
    if (err) line.err = serializeError(err);
    (level === 'error' ? process.stderr : process.stdout).write(`${JSON.stringify(line)}\n`);
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (extra) => createLogger({ ...base, ...extra }),
  };
}
