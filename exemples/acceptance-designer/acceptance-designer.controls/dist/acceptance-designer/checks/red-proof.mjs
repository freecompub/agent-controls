// FM-16 — si le test d'acceptance a changé, la preuve RED est présente et cohérente.
export default async function check(ctx) {
  if (!ctx.input.paths.some((p) => p.endsWith('AcceptanceTests.cs'))) return { ok: true }; // rework sans modification du test
  const ev = (ext) => ctx.input.paths.filter((p) => /\/evidence\/[^/]+\/[^/]+\/acceptance-red\./.test(p) && p.endsWith(ext));
  const [out, exit, rev] = ['.stdout', '.exit', '.rev'].map(ev);
  const problems = [];
  if (!out.length || !exit.length || !rev.length) problems.push('preuve incomplète : acceptance-red.stdout, .exit et .rev doivent être écrits pendant ce run');
  for (const e of exit) {
    const code = ctx.fs.readText(e).trim();
    if (!/^-?\d+$/.test(code)) problems.push(`${e} : code de sortie illisible « ${code.slice(0, 20)} »`);
    else if (Number(code) === 0) problems.push(`${e} : code de sortie 0, le test n'est pas RED`);
  }
  for (const r of rev) if (!/^[0-9a-f]{40}$/.test(ctx.fs.readText(r).trim())) problems.push(`${r} : révision Git invalide`);
  const compile = ctx.params.compile_error || '(error CS\\d{4}|error MSB\\d{4}|Build FAILED)';
  for (const o of out) if (new RegExp(compile).test(ctx.fs.readText(o))) problems.push(`${o} : échec de compilation, pas une assertion métier`);
  return problems.length ? { ok: false, details: problems.join('\n') } : { ok: true };
}
