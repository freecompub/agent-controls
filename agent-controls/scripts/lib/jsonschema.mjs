// Le validateur vit dans le runtime (il sert aussi au contrôle « schema » des plugins) ; ré-export pour les outils du skill.
export { validate } from '../runtime/lib/jsonschema.mjs';
