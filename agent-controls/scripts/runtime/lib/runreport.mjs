// Rapport de run : interface de sortie vers l'orchestrateur. Écrit dans le projet, chemin fixé par le contrat.
import fs from 'node:fs';
import path from 'node:path';

export function reportPath(contract, run) {
  if (!contract.report?.path) return null;
  const date = (run.st.created || new Date().toISOString()).slice(0, 10);
  return contract.report.path
    .replaceAll('{agent}', contract.agent.name)
    .replaceAll('{date}', date)
    .replaceAll('{run}', run.id);
}

/** Écrit le rapport (JSON) et retourne son chemin relatif, ou null. Ne lève jamais. */
export function writeRunReport({ contract, run, projectDir, status, iteration, lenses = [], controls = [], observations = [] }) {
  const rel = reportPath(contract, run);
  if (!rel) return null;
  try {
    const abs = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const report = {
      version: 1,
      agent: contract.agent.name,
      plugin_version: contract.plugin?.version,
      run: run.id,
      session: run.st.session,
      mode: run.st.mode || null,
      status, // running | refused | passed | escalated | blocked
      iteration,
      max_iterations: contract.runtime?.max_iterations ?? 3,
      at: new Date().toISOString(),
      controls, // [{ id, message }]
      lenses, // [{ name, status: pass | fail | inconclusive | error, findings: [{ criterion, severity, answer, question, evidence }] }]
      observations, // findings non bloquants
    };
    fs.writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`);
    return rel;
  } catch {
    return null;
  }
}
