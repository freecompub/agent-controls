<!-- markdownlint-disable-file -->
# Carte des intégrations et dépendances

| Cible | Protocole / usage | Confiance | Preuve |
|---|---|---|---|
| Claude Code | Hooks de plugin : événements et données JSON, commandes Node relatives à la racine du plugin ; agents et reviewers au format Claude. | High — intégration explicitement générée. | `scripts/generate.mjs`, `references/claude-code-hooks.md` |
| GitHub Copilot CLI / VS Code | Hooks JSON et agents au format Copilot ; la conversion est choisie par `agent.clients`. | High — formats et chemins explicitement générés. | `scripts/generate.mjs`, `references/copilot-hooks.md` |
| Node.js | Processus locaux pour dispatcher les hooks, exécuter des scripts et charger les modules ES. | High — appels Node visibles dans les scripts. | `scripts/run_fixtures.mjs`, `scripts/live_review.mjs`, `scripts/runtime/dispatch.mjs` |
| Git | Sous-processus locaux pour créer les dépôts de fixtures, prendre la baseline, calculer les changements/diff et lire l'état initial. | High — `spawnSync('git', ...)` et modules Git observés. | `scripts/run_fixtures.mjs`, `scripts/runtime/lib/git.mjs` |
| Système de fichiers du projet | Lecture des artefacts, écriture d'état/logs sous `.agent-controls/.runs/`, dépôts temporaires pour les tests ; le runtime déclare les fonctions de lecture fournies aux contrôles custom. | High — implémentations observées. | `runtime/lib/log.mjs`, `runtime/lib/state.mjs`, `runtime/lib/checks.mjs` |
| Shell déclaré dans le contrat | `run-command` peut lancer une commande locale avec `shell: true`, depuis la racine du projet, et un délai contraint. | High — code observé. | `runtime/lib/checks.mjs` |

## Intégrations non trouvées

Aucun client HTTP, SDK de service tiers, connexion base de données ou système de messagerie n'a été trouvé dans les sources examinées. (confidence: High — recherche des motifs d'instanciation et d'appels réseau dans `agent-controls/scripts/`)

Les interactions avec les modèles ne passent pas par une API du projet : le client hôte exécute lui-même les agents reviewers du plugin. (confidence: High — `agent-controls/SKILL.md`, `references/plugin-format.md`)

Les plugins génèrent des manifestes pour une marketplace, mais cela ne constitue pas un appel réseau exécuté par le code ; le registre est édité localement lors du packaging. (confidence: High — `scripts/package.mjs`)
