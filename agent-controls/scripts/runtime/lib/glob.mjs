// Glob minimal : **, *, ?, {a,b}. Chemins au format POSIX.
const esc = (s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');
const cache = new Map();

export function globToRegExp(glob) {
  if (cache.has(glob)) return cache.get(glob);
  let re = '';
  for (let i = 0; i < glob.length;) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 3; } else { re += '.*'; i += 2; }
      } else { re += '[^/]*'; i += 1; }
    } else if (c === '?') { re += '[^/]'; i += 1; }
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) { re += '\\{'; i += 1; continue; }
      re += `(?:${glob.slice(i + 1, end).split(',').map(esc).join('|')})`;
      i = end + 1;
    } else { re += esc(c); i += 1; }
  }
  const out = new RegExp(`^${re}$`);
  cache.set(glob, out);
  return out;
}

export const matchesAny = (p, globs) => globs.some((g) => globToRegExp(g).test(p));
