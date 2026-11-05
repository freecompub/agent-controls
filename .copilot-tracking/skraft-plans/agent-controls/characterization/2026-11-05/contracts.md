<!-- markdownlint-disable-file -->
# Contrats existants

## API externes

**contracts: none-found** pour OpenAPI, Swagger, AsyncAPI ou Pact : aucun contrat de service HTTP ou de messagerie de ces formats n'a été découvert. (confidence: High — recherche des marqueurs dans les fichiers YAML, JSON, Markdown et MJS)

Le projet n'expose pas d'API HTTP identifiée dans les sources examinées ; son interface d'exécution est celle des hooks de plugins des clients. (confidence: High — structure du dépôt et `scripts/generate.mjs`)

## Contrats locaux pertinents

| Contrat | Rôle |
|---|---|
| `agent-controls/assets/controls.schema.json` | Schéma versionné du contrat YAML de contrôles, converti/chargé par le code du skill. | (confidence: High) |
| `agent-controls/assets/verdict.schema.json` | Forme JSON attendue pour les verdicts de reviewers. | (confidence: High) |
| `agent-controls/references/controls-schema.md` | Documentation des règles métier supplémentaires, des types de contrôles et des fixtures. | (confidence: High) |
| `controls.json` généré | Contrat compilé embarqué dans le plugin ; utilisé par le dispatcher à l'exécution. | (confidence: High — `scripts/generate.mjs`, `runtime/dispatch.mjs`) |
| Fixtures JSON | Payload client normalisé utilisé par le runner pour simuler événements, fichiers de projet et verdicts mockés. | (confidence: High — `references/controls-schema.md`, `scripts/run_fixtures.mjs`) |

Les formats précis des payloads runtime sont adaptés séparément à Claude Code et Copilot dans `runtime/lib/normalize.mjs` et les références client ; aucune spécification formelle de ces API clientes n'est embarquée avec les contrats applicatifs. (confidence: High — fichiers et références cités)
