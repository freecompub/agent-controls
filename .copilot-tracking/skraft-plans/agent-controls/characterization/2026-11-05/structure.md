<!-- markdownlint-disable-file -->
# Structure et stack

## Stack et configuration

| Élément | Constat |
|---|---|
| Runtime | Node.js en modules ES (`.mjs`), Node.js ≥ 18 indiqué comme prérequis. (confidence: High — `agent-controls/SKILL.md`) |
| Dépendances | Scripts décrits comme JavaScript pur sans dépendances à installer ; le parseur YAML `js-yaml` est embarqué dans `scripts/vendor/`. (confidence: High — `agent-controls/SKILL.md`, `scripts/vendor/`) |
| Manifeste de dépendances | Aucun `package.json`, lockfile de gestionnaire ou manifest de build n'a été trouvé à la racine ni dans les sources examinées. (confidence: High — inventaire des fichiers) |
| Tests / CI | Pas de suite de tests conventionnelle ni de workflow CI trouvé ; les tests fonctionnels existants sont des fixtures invoquées par des scripts Node. (confidence: High — inventaire du dépôt, `scripts/run_fixtures.mjs`) |
| Historique | Le journal observé ne contient qu'un commit, `35a077d init` daté du 2026-11-05 ; il ne permet pas d'inférer des zones de churn ou de maintenance. (confidence: High — `git log`) |

## Disposition

| Chemin | Rôle observé |
|---|---|
| `agent-controls/SKILL.md` | Procédure d'analyse, conception des contrôles, génération, tests et livraison du skill. (confidence: High) |
| `agent-controls/assets/` | Schémas JSON des contrats et verdicts, plus un exemple d'agent/contrat. (confidence: High) |
| `agent-controls/references/` | Règles des hooks clients, format de plugin, schéma de contrat, modes de défaillance et critères de qualité. (confidence: High) |
| `agent-controls/scripts/` | CLI d'inspection, validation, génération, fixtures, revue live, preview et packaging ; `lib/` contient les utilitaires partagés. (confidence: High) |
| `agent-controls/scripts/runtime/` | Dispatcher des hooks, modules d'état, normalisation, contrôles, revue, journalisation et rapport. (confidence: High) |
| `exemples/acceptance-designer/` | Définition d'agent, contrat, contrôles custom, fixtures, rapport de fixtures et plugin généré. (confidence: High) |
| `exemples/solution-architect/` | Même type d'exemple pour un agent d'architecture, avec plusieurs contrôles custom et plugin généré. (confidence: High) |

Le dépôt contient 231 fichiers hors `.git` lors de l'inventaire, dont 82 `.mjs`, 31 Markdown et 112 JSON/YAML. (confidence: High — inventaire des fichiers)

## Architecture d'exécution

Les contrats et fixtures sont les entrées déclaratives ; `generate.mjs` compile le contrat, copie le runtime et les modules custom, puis écrit les manifestes, agents et hooks propres aux clients sélectionnés. (confidence: High — `scripts/generate.mjs`)

Un unique dispatcher normalise le payload Claude/Copilot, identifie l'agent, applique les contrôles actifs, maintient l'état du run dans le projet et rend la décision au format du client. (confidence: High — `scripts/runtime/dispatch.mjs`, `runtime/lib/normalize.mjs`, `runtime/lib/output.mjs`)

Le reviewer est un agent du plugin lancé par le client ; son verdict est ensuite validé et les hooks de fin de run décident entre validation, reprise et escalade. (confidence: High — `runtime/lib/review.mjs`, `references/plugin-format.md`)
