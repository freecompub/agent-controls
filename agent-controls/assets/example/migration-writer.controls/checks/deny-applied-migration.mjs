export default async function check(ctx){
  const reg = ctx.params.registry;
  if(!ctx.fs.exists(reg)) return {ok:true};
  const applied = JSON.parse(ctx.fs.readText(reg));
  const hit = ctx.input.paths.filter(p=>applied.includes(p));
  return hit.length ? {ok:false, details:`déjà appliquée(s) : ${hit.join(', ')}`} : {ok:true};
}
