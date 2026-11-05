// Utilitaires communs — sans dépendance.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const hash = (s, n = 16) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, n);

export const toPosix = (p) => String(p).split(path.sep).join('/').replace(/\\/g, '/');

/** Chemin relatif à la racine du projet, séparateur « / » sur toutes les plateformes. */
export function rel(projectDir, p) {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.join(projectDir, p);
  return toPosix(path.relative(projectDir, abs));
}

export function readJSON(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

export function writeJSONAtomic(p, obj) {
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

/** Échappe un argument pour un shell (cmd.exe sous Windows, sh ailleurs). */
export function quoteArg(a) {
  const s = String(a);
  if (process.platform === 'win32') return `"${s.replace(/"/g, '""')}"`;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export const truncate = (s, n = 500) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

const SECRET_PATTERNS = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,
  /\b(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@\/]+:[^\s@\/]+@[^\s]+/gi, // chaîne de connexion avec identifiants
];

/** Masque les secrets courants. Appliqué à tout texte qui peut finir dans un log ou un message. */
export function mask(s) {
  if (!s) return s;
  let out = String(s);
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[MASQUÉ]');
  return out;
}

/** Compile une expression régulière ; accepte un préfixe de drapeaux en ligne (?i), (?im)… */
export function compileRegex(pattern) {
  const m = /^\(\?([ims]+)\)/.exec(pattern);
  if (m) return new RegExp(pattern.slice(m[0].length), [...new Set(m[1])].join(''));
  return new RegExp(pattern);
}

/** Valeurs de gabarit pour un chemin : {path} {dir} {basename} {ext}. */
export function templateValues(p) {
  const posix = toPosix(p || '');
  const ext = path.posix.extname(posix);
  return {
    path: posix,
    dir: path.posix.dirname(posix),
    basename: path.posix.basename(posix, ext),
    ext,
  };
}

export function fillTemplate(tpl, p, quote = false) {
  const v = templateValues(p);
  return tpl.replace(/\{(path|dir|basename|ext)\}/g, (_, k) => (quote ? quoteArg(v[k]) : v[k]));
}

export function stripFrontmatter(md) {
  return String(md || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}
