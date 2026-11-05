# Inventaire des modes de défaillance

À lire en phase 2. Objectif : une liste de défaillances **observables**, chacune assez précise pour qu'on puisse dire, sur un diff ou une commande, si elle s'est produite.

## Méthode

Parcours les quatre axes dans l'ordre. Pour chaque axe, pose la question indiquée sur chaque élément de la fiche agent (phase 1).

| Axe | Question | Source dans la fiche |
|---|---|---|
| Outil × zone | « Que peut-il faire de travers avec cet outil sur cette zone ? » | outils autorisés, zones touchées |
| Livrable | « À quoi ressemble ce livrable s'il est faux ou incomplet ? » | livrables attendus |
| Fin de tâche | « Peut-il déclarer fini sans l'être ? » | livrables, mode d'invocation |
| Irréversible | « Qu'est-ce qui ne se rattrape pas ? » | outils `shell.exec`, `web.fetch`, `mcp.call` |

Ne cherche pas l'exhaustivité théorique : vise les défaillances plausibles pour **cet** agent. Huit à quinze modes est un ordre de grandeur habituel ; au-delà de vingt, regroupe.

## Catalogue par catégorie d'outil

Points de départ, à adapter. Ne les recopie pas tels quels : un mode n'entre dans l'inventaire que s'il est plausible pour l'agent analysé.

**`file.write`**
- écrit hors de sa zone (fichiers de config, CI, secrets, autres modules) ;
- modifie un fichier qui ne doit plus bouger (migration appliquée, fichier généré, lockfile) ;
- supprime ou vide un fichier au lieu de le modifier ;
- produit un fichier syntaxiquement invalide ;
- introduit un secret ou une donnée réelle (jeu de test avec données de production).

**`shell.exec`**
- commande destructive (suppression, reset, drop, force push) ;
- commande à effet externe (déploiement, publication, envoi) ;
- installation de dépendance non prévue ;
- contournement des tests ou du lint (`--no-verify`, désactivation de règles).

**`web.fetch` / `mcp.call`**
- envoi de code ou de données vers l'extérieur ;
- action d'écriture sur un système tiers (ticket, base, message).

**`subagent.spawn`**
- délègue une tâche hors de son périmètre ;
- délègue à un agent sans contrôles ce qu'il ne peut pas faire lui-même.

**Fin de tâche**
- livrable annoncé mais absent ;
- tests annoncés « passés » sans avoir été exécutés ;
- tâche partiellement traitée présentée comme complète.

## Grille de gravité

| Gravité | Critère | Exigence de couverture |
|---|---|---|
| `critical` | Irréversible, atteint des données réelles ou la production, ou impact sur la sécurité du patient | Hook avec `on_error: block` obligatoire (sinon avertissement justifié) |
| `high` | Réversible mais coûteux : casse le build, corrompt un livrable, demande une intervention humaine | Hook de préférence, reviewer acceptable |
| `medium` | Dégrade la qualité sans casser : tests insuffisants, documentation absente | Reviewer acceptable |
| `low` | Gêne mineure, style | À couvrir seulement si le contrôle est quasi gratuit |

En cas d'hésitation entre deux niveaux, prends le plus élevé et dis-le.

## Règles d'écriture

- **Observable** : décris ce qu'on verrait. « Écrit dans `migrations/` sans fichier `plans/` correspondant », pas « ne planifie pas assez ».
- **Un mode, une défaillance** : pas de « et ». Deux défaillances liées font deux modes.
- **Sans solution** : le mode décrit le problème, pas le contrôle. Le contrôle vient en phase 3.
- **Identifiants stables** : `FM-01`, `FM-02`… Ne renumérote jamais un mode existant ; un mode retiré laisse son numéro inutilisé.

## Anti-modèles

| À éviter | Pourquoi | Mieux |
|---|---|---|
| « Code de mauvaise qualité » | Non observable | « Fonction modifiée sans test mis à jour » |
| « Hallucine » | Non observable | « Référence une table absente du schéma » |
| « Ne respecte pas les consignes » | Trop large | Un mode par consigne qui compte |
| « Peut casser la prod » | Mélange cause et effet | « Exécute une commande de déploiement » |
