// Empreinte d'un dossier : relie un résultat de fixtures au plugin exact sur lequel il a été obtenu.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function digestDir(root) {
  const h = crypto.createHash('sha256');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      h.update(path.relative(root, p).split(path.sep).join('/'));
      h.update('\0');
      h.update(fs.readFileSync(p));
      h.update('\0');
    });
  walk(root);
  return h.digest('hex');
}
