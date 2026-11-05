#!/usr/bin/env node
// Fixtures pour inspect_folder.mjs : pour chaque sous-dossier de scripts/tests/inspect_folder/,
// lance `inspect_folder.mjs <cas>/input --json` et compare au `expected.json` du cas (la valeur
// `source_sha256` est normalisée en "<sha256>" car elle dépend du contenu exact du fichier fixture).
//   node run_inspect_folder_tests.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const casesDir = path.join(here, 'inspect_folder');
const script = path.join(here, '..', 'inspect_folder.mjs');

const SHA_RE = /^[a-f0-9]{64,}$/i;
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'root') continue; // chemin absolu, dépend de la machine
      out[k] = k === 'source_sha256' && typeof v === 'string' && SHA_RE.test(v) ? '<sha256>' : normalize(v);
    }
    return out;
  }
  return value;
}

let failed = 0;
let total = 0;
for (const name of fs.readdirSync(casesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
  const caseDir = path.join(casesDir, name);
  const input = path.join(caseDir, 'input');
  const expectedFile = path.join(caseDir, 'expected.json');
  if (!fs.existsSync(input) || !fs.existsSync(expectedFile)) continue;
  total++;
  const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
  const r = spawnSync(process.execPath, [script, input, '--json'], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.log(`ÉCHEC ${name} : inspect_folder.mjs a quitté avec le code ${r.status}\n${r.stderr}`);
    continue;
  }
  let actual;
  try { actual = JSON.parse(r.stdout); } catch (e) {
    failed++;
    console.log(`ÉCHEC ${name} : sortie non-JSON (${e.message})`);
    continue;
  }
  const got = JSON.stringify(normalize(actual), null, 2);
  const want = JSON.stringify(normalize(expected), null, 2);
  if (got !== want) {
    failed++;
    console.log(`ÉCHEC ${name} :\n--- attendu ---\n${want}\n--- obtenu ---\n${got}`);
  } else {
    console.log(`OK ${name}`);
  }
}

console.log(`\n${total - failed}/${total} cas passants.`);
process.exit(failed ? 1 : 0);
