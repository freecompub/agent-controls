#!/usr/bin/env node
// Valide un contrat : node validate_controls.mjs <chemin/controls.yaml>
// Code de sortie 0 si aucune erreur (les avertissements n'empêchent pas la suite), 1 sinon.
import { loadContract } from './lib/contract.mjs';

const target = process.argv[2];
if (!target) { console.error('usage : node validate_controls.mjs <controls.yaml>'); process.exit(2); }
const { errors, warnings } = loadContract(target);
for (const e of errors) console.log(`ERREUR        ${e}`);
for (const w of warnings) console.log(`AVERTISSEMENT ${w}`);
console.log(errors.length ? `\n${errors.length} erreur(s), ${warnings.length} avertissement(s).` : `\nContrat valide. ${warnings.length} avertissement(s).`);
process.exit(errors.length ? 1 : 0);
