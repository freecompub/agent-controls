<!-- markdownlint-disable-file -->
# Inventaire des fonctionnalités

| Fonctionnalité | Éléments probants | Confiance | Catégorie |
|---|---|---|---|
| Inspection d'une définition d'agent : outils, entrées/sorties, skills, empreinte et incohérences mécaniques. | `scripts/inspect_agent.mjs`, appelé dans la phase 1 du skill. | High — implémentation et procédure directement observées. | Core |
| Définition et validation du contrat déclaratif : schéma, modes de défaillance, contrôles, critères reviewer et fixtures. | `assets/controls.schema.json`, `scripts/validate_controls.mjs`, `scripts/lib/contract.mjs`. | High — schéma et point d'entrée de validation observés. | Core |
| Compilation du plugin pour Claude Code/Copilot : agents, hooks, runtime, manifestes, README et modules. | `scripts/generate.mjs`, `references/plugin-format.md`. | High — génération et formats documentés dans le code. | Core |
| Enforcement au runtime : normalisation des événements, filtrage agent, contrôles avant/après outil et vérifications à l'arrêt. | `scripts/runtime/dispatch.mjs`, `runtime/lib/checks.mjs`, `runtime/lib/review.mjs`. | High — chemins d'exécution directement observés. | Core |
| Boucle de revue : dossiers par lentille, lancement de reviewers par le client, validation des verdicts, reprise/escalade. | `runtime/lib/review.mjs`, `runtime/lib/reviewer.mjs`, `assets/verdict.schema.json`. | High — code de gestion et schéma du verdict observés. | Core |
| Fixtures mécaniques sur dépôt temporaire et mesure des latences. | `scripts/run_fixtures.mjs` ; rapports d'exemples pour Claude et Copilot. | High — runner et rapports présents. | Core |
| Préparation/collecte de revues live et vérification du jugement du reviewer sur client réel. | `scripts/live_review.mjs`, `scripts/preview_review.mjs`; README signale que les revues live des deux exemples restent à faire. | Medium — les scripts et le gate existent, mais le comportement réel du client n'est pas démontré. | Core |
| Gate de packaging/versionnement et inscription optionnelle dans une marketplace. | `scripts/package.mjs`, `scripts/lib/digest.mjs`, `scripts/lib/reviewdigest.mjs`. | High — conditions de gate et écriture de marketplace observées. | Core |
| Journalisation locale et rapports de mesures des runs. | `runtime/lib/log.mjs`, `runtime/lib/runreport.mjs`, `runtime/report.mjs`. | High — écritures et agrégations directement observées. | Secondary |

## Parcours type

L'utilisateur fournit l'agent Markdown ; le skill guide l'analyse puis la création d'un `controls.yaml`. Les scripts vérifient ce contrat, génèrent un plugin, exécutent les fixtures, imposent une revue live lorsqu'un reviewer est configuré, puis refusent le packaging si le plugin, les rapports, les versions ou la revue réelle ne sont pas conformes. (confidence: High — `agent-controls/SKILL.md`, `scripts/package.mjs`)

Les décisions d'architecture s'articulent autour d'une règle : les contrôles mécaniques sont des hooks déterministes ; les décisions nécessitant un jugement sont des critères de reviewer. (confidence: High — `agent-controls/SKILL.md`, phases 2–3)
