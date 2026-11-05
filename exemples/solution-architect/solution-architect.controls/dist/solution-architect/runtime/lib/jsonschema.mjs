// Validateur JSON Schema minimal : couvre les mots-clés utilisés par les schémas du skill.
// type, const, enum, pattern, minLength, maxLength, minimum, maximum, minItems, maxItems,
// uniqueItems, items, contains, required, properties, additionalProperties, oneOf, if/then, $ref (#/$defs/…).
export function validate(schema, data) {
  const errors = [];
  const root = schema;
  const resolve = (s) => {
    while (s && s.$ref) {
      const parts = s.$ref.replace(/^#\//, '').split('/');
      s = parts.reduce((o, k) => o?.[k], root);
    }
    return s;
  };
  const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v);
  const typeOk = (t, v) => t === typeOf(v) || (t === 'number' && typeof v === 'number');

  function check(s, v, at, out) {
    s = resolve(s);
    if (!s || s === true) return;
    const err = (m) => out.push(`${at || '(racine)'} : ${m}`);
    if (s.type && !typeOk(s.type, v)) return err(`type ${s.type} attendu`);
    if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(v)) err(`valeur ${JSON.stringify(s.const)} attendue`);
    if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) err(`une valeur parmi ${s.enum.join(', ')} attendue`);
    if (typeof v === 'string') {
      if (s.pattern && !new RegExp(s.pattern).test(v)) err(`format invalide (${s.pattern})`);
      if (s.minLength !== undefined && v.length < s.minLength) err(`au moins ${s.minLength} caractère(s)`);
      if (s.maxLength !== undefined && v.length > s.maxLength) err(`au plus ${s.maxLength} caractère(s)`);
    }
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) err(`minimum ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) err(`maximum ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) err(`au moins ${s.minItems} élément(s)`);
      if (s.maxItems !== undefined && v.length > s.maxItems) err(`au plus ${s.maxItems} élément(s)`);
      if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) err('éléments en double');
      if (s.items) v.forEach((x, i) => check(s.items, x, `${at}[${i}]`, out));
      if (s.contains && !v.some((x) => { const o = []; check(s.contains, x, at, o); return !o.length; })) err('élément requis absent');
    }
    if (typeOf(v) === 'object') {
      for (const r of s.required || []) if (!(r in v)) err(`champ « ${r} » obligatoire`);
      if (s.minProperties !== undefined && Object.keys(v).length < s.minProperties) err(`au moins ${s.minProperties} champ(s)`);
      for (const [k, x] of Object.entries(v)) {
        if (s.properties && k in s.properties) check(s.properties[k], x, at ? `${at}.${k}` : k, out);
        else if (s.additionalProperties === false) err(`champ « ${k} » non autorisé`);
        else if (typeof s.additionalProperties === 'object') check(s.additionalProperties, x, at ? `${at}.${k}` : k, out);
      }
    }
    if (s.oneOf) {
      const results = s.oneOf.map((sub) => { const o = []; check(sub, v, at, o); return o; });
      const ok = results.filter((o) => !o.length).length;
      if (ok !== 1) {
        // message utile : la variante dont le « type » correspond, sinon un résumé
        const typed = s.oneOf.findIndex((sub) => resolve(sub)?.properties?.type?.const === v?.type);
        if (typed >= 0) out.push(...results[typed]); else err(ok ? 'plusieurs variantes correspondent' : 'aucune variante ne correspond');
      }
    }
    if (s.if) {
      const o = []; check(s.if, v, at, o);
      if (!o.length && s.then) check(s.then, v, at, out);
    }
  }
  check(schema, data, '', errors);
  return errors;
}
