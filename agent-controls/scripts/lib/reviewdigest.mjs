// Empreinte de tout ce qui détermine le jugement du reviewer : si elle change, la revue réelle doit être relancée.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function reviewerDigest(pluginDir) {
  const compiled = JSON.parse(fs.readFileSync(path.join(pluginDir, 'controls.json'), 'utf8'));
  if (!compiled.reviewer) return null;
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify(compiled.reviewer));
  const reviewerFiles = ['agents', 'copilot/agents'].flatMap((d) => {
    try { return fs.readdirSync(path.join(pluginDir, d)).filter((f) => f.includes('-review-')).sort().map((f) => `${d}/${f}`); } catch { return []; }
  });
  for (const rel of [...reviewerFiles, ...(compiled.reviewer.knowledge || []).map((k) => k.path)]) {
    try { h.update(fs.readFileSync(path.join(pluginDir, rel))); } catch { h.update(`absent:${rel}`); }
  }
  for (const f of ['reviewer.mjs', 'review.mjs', 'verdict.mjs']) h.update(fs.readFileSync(path.join(pluginDir, 'runtime', 'lib', f)));
  return h.digest('hex');
}
