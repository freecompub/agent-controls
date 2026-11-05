// Mode du run (déterminé par la consigne) et sortie bloquée (déterminée par le message final).
import fs from 'node:fs';
import { compileRegex } from './util.mjs';

export function detectMode(contract, task) {
  if (!task) return null;
  for (const m of contract.modes || []) {
    try { if (compileRegex(m.task_pattern).test(task)) return m.name; } catch { /* validée en amont */ }
  }
  return null;
}

/** Contrôles et critères actifs pour le mode du run. */
export function active(contract, st) {
  const disabled = new Set((contract.modes || []).find((m) => m.name === st?.mode)?.disable || []);
  const on = (x) => !disabled.has(x.id) && (!x.only_in_modes || x.only_in_modes.includes(st?.mode));
  return {
    controls: contract.controls.filter(on),
    criteria: (contract.reviewer?.criteria || []).filter(on),
  };
}

export function isBlockedExit(contract, message) {
  if (!contract.blocked_exit || !message) return false;
  return contract.blocked_exit.patterns.some((p) => { try { return compileRegex(p).test(message); } catch { return false; } });
}

/**
 * Dernier message texte de l'assistant dans un transcript JSONL (format Claude Code).
 * À VÉRIFIER (phase 7) : chemin du transcript d'un subagent et forme exacte des lignes selon la version.
 */
export function lastAssistantText(transcriptPath, maxBytes = 512 * 1024) {
  if (!transcriptPath) return null;
  try {
    const size = fs.statSync(transcriptPath).size;
    const fd = fs.openSync(transcriptPath, 'r');
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const l of lines) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      const msg = e.message || e;
      if ((e.type || msg.role) !== 'assistant') continue;
      const content = msg.content;
      const text = typeof content === 'string' ? content
        : Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') : '';
      if (text.trim()) return text;
    }
  } catch { /* transcript indisponible */ }
  return null;
}
