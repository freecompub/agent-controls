// Logs JSONL locaux. Ne jamais écrire sur stdout ni stderr ; un échec de log ne casse jamais un contrôle.
import fs from 'node:fs';
import path from 'node:path';

export function runsDir(projectDir) {
  return path.join(projectDir, '.agent-controls', '.runs');
}

/** Crée .agent-controls/ avec son propre .gitignore : rien n'est versionné, sans toucher au .gitignore du projet. */
export function ensureWorkspace(projectDir) {
  try {
    const base = path.join(projectDir, '.agent-controls');
    fs.mkdirSync(path.join(base, '.runs'), { recursive: true });
    const gi = path.join(base, '.gitignore');
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
  } catch { /* best effort */ }
}

export function makeLogger(projectDir, base) {
  const root = runsDir(projectDir);
  return (runId, rec) => {
    try {
      const dir = path.join(root, runId || '_sans-run');
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'events.jsonl'),
        `${JSON.stringify({ v: 1, ts: new Date().toISOString(), ...base, ...rec })}\n`);
    } catch { /* jamais bloquant */ }
  };
}
