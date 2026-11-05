<!-- markdownlint-disable-file -->
# Caractérisation de `agent-controls` — 2026-11-05

## Synthèse

- **Objet** : le dépôt fournit un skill qui transforme la définition Markdown d'un agent en plugin contrôlé, avec hooks déterministes, reviewers exécutés par le client et outils de génération/test/packaging. (confidence: High — `README.md`, `agent-controls/SKILL.md`)
- **Périmètre observé** : sources du skill, schémas et références, scripts Node.js, runtime, deux exemples complets et leurs rapports de fixtures. (confidence: High — inventaire du dépôt)
- **Verdict** : **CONCERNS**. Les fixtures d'exemples prouvent une partie du runtime, mais les phases de validation, génération, packaging et reporting n'ont pas de tests dédiés visibles ; les deux exemples indiquent que la revue réelle sur client reste à effectuer. (confidence: High — `README.md`, rapports `.fixtures-report.json`; couverture détaillée dans `coverage.md`)
- **Distribution de confiance** : sur les 9 fonctionnalités inventoriées, 8 sont classées High et 1 Medium (89 % / 11 % / 0 % Low). Ce décompte porte sur les classifications fonctionnelles, pas sur les faits cités. (confidence: High — comptage des lignes de `features.md`)
- **Traçabilité** : 0/9 FULL (0 %), 2/9 PARTIAL (22 %), 7/9 NONE (78 %). (confidence: High — classification de `coverage.md`)

## Ce que fait le projet

Le parcours principal prend un agent `.md` et un contrat `controls.yaml`, identifie les modes de défaillance, vérifie le contrat, génère les assets du plugin pour Claude Code et/ou Copilot, puis teste les hooks via des fixtures. À l'exécution, le runtime filtre par agent, contrôle les actions/outils, vérifie le diff à la fin du run et peut imposer une revue par des agents reviewers du plugin. (confidence: High — `agent-controls/SKILL.md`, `scripts/*.mjs`, `scripts/runtime/dispatch.mjs`)

Les reviewers ne sont pas appelés par une API ou un SDK : le client les lance comme sous-agents du plugin. (confidence: High — `agent-controls/SKILL.md`, `references/plugin-format.md`)

## Points à confirmer

- Les tests existants couvrent des scénarios de hooks configurés dans les deux exemples, mais ne démontrent pas la fiabilité des scripts de validation, de génération, de packaging ou des statistiques de run. (confidence: High — `coverage.md`)
- Les rapports checked-in affichent 102/102 et 112/112 vérifications réussies sur Claude et Copilot ; ils ne couvrent pas le jugement réel des reviewers. Le README indique que les gates de livraison refusent encore les exemples faute de revue réelle. (confidence: High — rapports des exemples et `README.md`)
- Les inconnues d'intégration propres aux clients (résolution des commandes de hooks, retour de sous-agent et données du transcript) sont explicitement listées dans le README et les références. (confidence: High — `README.md`, `references/claude-code-hooks.md`, `references/copilot-hooks.md`)

La liste de validation des fonctionnalités Core en couverture NONE figure dans `coverage.md`. (confidence: High — `coverage.md`)
