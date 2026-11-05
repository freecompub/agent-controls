<!-- markdownlint-disable-file -->
# Traçabilité des fonctionnalités et de leurs tests

Échelle : FULL = assertions directes sur le comportement de la fonctionnalité ; PARTIAL = certaines voies/scénarios sont exercés, sans couverture complète ; NONE = pas de test direct trouvé. Les rapports de fixtures sont des preuves d'exécution du runtime des exemples, pas des tests généraux des CLIs qui les ont produits. (confidence: High — règles d'évaluation et fichiers de tests observés)

| Fonctionnalité | Couverture | Preuve / limite |
|---|---|---|
| Inspection d'une définition d'agent | NONE | Aucun test direct de `inspect_agent.mjs` trouvé. (confidence: High — inventaire des fichiers) |
| Validation du contrat | NONE | Aucun test direct de `validate_controls.mjs` ou de ses cas valides/invalides trouvé. (confidence: High — inventaire des fichiers) |
| Génération du plugin | NONE | Des plugins générés sont fournis, mais aucun test direct de leur génération ou de leur conversion n'est présent. (confidence: High — inventaire et arborescences d'exemples) |
| Enforcement des hooks et contrôles | PARTIAL | Deux rapports de fixtures passent : acceptance-designer 102/102 et solution-architect 112/112, pour Claude et Copilot. Ils ne couvrent que les contrats présents dans les exemples. (confidence: High — `.fixtures-report.json` des exemples) |
| Cycle reviewer mécanique (verdict simulé) | PARTIAL | Les fixtures sont exécutées à travers les hooks et testent certaines décisions mockées ; elles ne vérifient pas le jugement réel du modèle. (confidence: High — `scripts/run_fixtures.mjs`, rapports d'exemples) |
| Runner de fixtures et budgets de latence | NONE | Des rapports produits sont présents, mais aucun test indépendant n'assert les erreurs du runner, la fidélité des mesures ou le gate de rapport. (confidence: Medium — absence observée ; les rapports ne testent pas leur propre producteur) |
| Revue live du reviewer sur client réel | NONE | Aucun rapport live n'est fourni ; `README.md` indique que la revue réelle reste à faire pour les deux exemples. (confidence: High — présence/absence des rapports et README) |
| Gate de packaging et ajout marketplace | NONE | Aucun test de `package.mjs` ou d'inscription dans une marketplace trouvé. (confidence: High — inventaire des fichiers) |
| Rapport de mesures runtime | NONE | Aucun test direct du calcul des taux, faux positifs, latences ou agrégats de runs trouvé. (confidence: High — inventaire des fichiers) |

## Synthèse de couverture

- FULL : 0/9 (0 %). (confidence: High — comptage du tableau)
- PARTIAL : 2/9 (22 %). (confidence: High — comptage du tableau)
- NONE : 7/9 (78 %). (confidence: High — comptage du tableau)

## Checklist de validation humaine

Gate **CONCERNS** : les fonctionnalités Core avec couverture NONE sont l'inspection, la validation du contrat, la génération du plugin, le runner de fixtures, la revue réelle, le packaging/marketplace et le reporting. Pour confirmer leur état, fournir ou exécuter des tests ciblés couvrant ces chemins. (confidence: High — tableau de couverture)

Le jugement réel des reviewers et le chargement effectif des plugins doivent être vérifiés dans chaque client ciblé ; les fixtures mécaniques ne remplacent pas cette validation. (confidence: High — `README.md`, `references/plugin-format.md`)
