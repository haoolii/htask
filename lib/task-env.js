'use strict';

const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');

const supported = [
  'OPENCODE_MODEL', 'OPENCODE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY',
];

function modelRef(value) {
  if (!value) return undefined;
  const match = /^([a-zA-Z0-9_.-]+)\/([^#\s]+)(?:#([a-zA-Z0-9_.-]+))?$/.exec(value);
  if (!match) throw new Error('OPENCODE_MODEL must use provider/model or provider/model#variant');
  const [, providerID, id, variant] = match;
  return variant ? { providerID, id, variant } : { providerID, id };
}

function readTaskEnv(file) {
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  const parsed = parseEnv(contents);
  const values = Object.fromEntries(supported.filter(key => parsed[key]).map(key => [key, parsed[key]]));
  modelRef(values.OPENCODE_MODEL);
  return values;
}

module.exports = { modelRef, readTaskEnv };
