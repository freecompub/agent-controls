<!-- markdownlint-disable-file -->
# Écarts et risques

Échelle de risque : probabilité (P) et impact (I), chacun de 1 à 3 ; score = P × I. 9 = P0/BLOCK, 6–8 = P1/MITIGATE, 4–5 = P2/MONITOR, 1–3 = P3/DOCUMENT. Les notes P/I sont des appréciations de risque, non des mesures statistiques. (confidence: High — méthode du skill ; Medium — appréciation des niveaux)

| Écart / risque | P | I | Score | Bande / action | Éléments probants et commentaire |
|---|---:|---:|---:|---|---|
| Comportement des hooks réels non vérifié dans les clients | 3 | 3 | 9 | P0 — BLOCK | Le README liste des points à vérifier en conditions réelles ; la revue réelle des exemples n'a pas été faite et les gates restent refusés. Ne pas traiter les fixtures comme preuve de chargement réel. (confidence: High — `README.md`, rapports des exemples ; Medium — score) |
| Pas de tests directs visibles pour les CLIs centrales et le rapport de métriques | 2 | 3 | 6 | P1 — MITIGATE | Pas de suite conventionnelle ; aucun test direct trouvé pour inspect, validate, generate, package ou report. Les fixtures donnent une couverture partielle des hooks seulement. (confidence: High — inventaire et `coverage.md` ; Medium — score) |
| Absence de CI automatisée détectée | 2 | 2 | 4 | P2 — MONITOR | Aucun workflow CI n'a été trouvé. (confidence: High — inventaire des fichiers ; Medium — score) |

## Portée de la caractérisation

L'historique ne comporte qu'un commit initial, ce qui empêche d'identifier les parties du code les plus actives ou des régressions documentées par churn. (confidence: High — `git log`)

Le risque P0 concerne le blocage de la livraison d'un plugin considéré prêt tant que les tests de chargement/réaction réels ne sont pas passés ; il ne signifie pas qu'un défaut runtime a été observé. (confidence: Medium — interprétation des gates et des inconnues listées dans `README.md`)
