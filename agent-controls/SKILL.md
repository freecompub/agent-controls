---
name: agent-controls
description: À partir du fichier .md d'un agent (Claude Code ou GitHub Copilot), génère un plugin prêt à l'emploi qui embarque l'agent et tous ses contrôles — analyse des modes de défaillance, hooks déterministes (PreToolUse, PostToolUse, SubagentStop), reviewer en lecture seule avec boucle de correction, fixtures de test, logs de mesure, manifestes Claude Code et Copilot. Utilise ce skill dès que l'utilisateur fournit un agent et veut y ajouter des contrôles, garde-fous, guardrails, hooks, un reviewer ou une validation, ou le transformer en plugin contrôlé, même s'il ne dit pas « contrôle » ni « plugin ». Ne pas utiliser pour écrire l'agent lui-même, concevoir le SDLC ou écrire un pipeline CI.
---

# agent-controls

L'utilisateur écrit ses agents ; ce skill les rend contrôlés. **Entrée** : le fichier `.md` d'un agent. **Sortie** : un plugin autonome, installable sur Claude Code et Copilot, qui embarque l'agent, son reviewer, ses hooks et le runtime.

Le modèle fait l'analyse (défaillances, classement des contrôles) ; des scripts déterministes génèrent et testent le plugin à partir d'un contrat unique, `controls.yaml`.

Principe : un contrôle vérifiable par une règle devient un **hook** ; un contrôle qui demande un jugement devient un **critère du reviewer**, dont l'exécution est elle-même imposée par un hook `SubagentStop`. Le skill est un guide ; ses livrables sont de l'enforcement.

## Prérequis

- Le fichier `.md` de l'agent.
- Node.js ≥ 18. Les scripts sont en JavaScript pur, sans dépendance ; ne jamais les lancer via `npx`.
- Les projets où le plugin sera utilisé sont des dépôts Git (le reviewer travaille sur le diff depuis une baseline).

Dans les commandes ci-dessous, `<skill>` désigne le dossier de ce skill.

## Arborescence

```
<dossier de l'agent>/
├── migration-writer.md              # AGENT DE L'UTILISATEUR — lu, jamais modifié
└── migration-writer.controls/       # SOURCE des contrôles
    ├── controls.yaml                # contrat, seule source de vérité
    ├── checks/                      # modules custom (*.mjs)
    ├── fixtures/                    # payloads de test normalisés
    └── dist/migration-writer/       # PLUGIN GÉNÉRÉ — ne jamais éditer
        ├── .claude-plugin/plugin.json      # manifeste Claude Code
        ├── plugin.json                     # manifeste Copilot
        ├── agents/                         # copie de l'agent, format Claude Code
        ├── hooks/hooks.json                # hooks, format Claude Code
        ├── copilot/agents/                 # copie de l'agent, format Copilot
        ├── agents/<agent>-review-<lentille>.md   # un agent reviewer par lentille (aussi sous copilot/agents/)
        ├── copilot/hooks.json              # hooks, format Copilot
        ├── runtime/                        # dispatcher, logs, état du run
        ├── checks/                         # copie des modules custom
        ├── controls.json                   # contrat compilé
        └── README.md                       # installation, contrôles, mesures
```

Le détail des deux formats de plugin est dans `references/plugin-format.md`.

## Workflow

Huit phases. Les phases 1 à 3 se terminent par un **point d'arrêt** : présente le résultat et attends la validation de l'utilisateur avant de continuer. Ne fusionne pas les phases : chaque erreur d'analyse se propage dans tout ce qui est généré.

### Phase 1 — Analyser l'agent

Commence par `node <skill>/scripts/inspect_agent.mjs <agent.md>` : il extrait les outils et leur catégorie, l'empreinte du fichier, et les entrées et sorties déclarées dans le frontmatter, converties en globs. Puis lis le prompt et établis une fiche :

- **Outils autorisés**, traduits en catégories : `file.read`, `file.write`, `shell.exec`, `web.fetch`, `subagent.spawn`, `mcp.call`.
- **Zones touchées** : chemins ou motifs de fichiers que l'agent lit et écrit dans les projets où il travaille.
- **Livrables attendus** : ce que l'agent est censé produire en fin de tâche.
- **Mode d'invocation** : agent principal, subagent, ou les deux.
- **Clients cibles** : à demander si le format du fichier ne le dit pas.
- **Sorties anticipées** : cas où l'agent doit s'arrêter sans livrer (artefact manquant, contradiction), et la forme de ce message d'arrêt.
- **Modes** : variantes de comportement annoncées dans la consigne (reprise après revue, par exemple) qui changent ce qu'il a le droit de faire.
- **Skills et références chargés par l'agent** : `inspect_agent.mjs` les liste. Leurs règles (souvent les règles du métier : architecture, méthode de test…) ne sont pas dans le fichier de l'agent. **Nomme-les à l'utilisateur et propose-lui de les fournir ; ne va jamais les chercher toi-même.** S'il ne les fournit pas, elles iront dans `uncovered_sources` du contrat.
- **Incohérences de la définition** : commandes demandées sans outil shell déclaré, écritures absentes des sorties déclarées. Signale-les : c'est à l'utilisateur de corriger l'agent.
- **Exemples réels** : demande un exemple de chaque fichier lu ou produit par l'agent dont le format pourrait conditionner un contrôle (artefacts d'entrée, livrables, consigne de délégation, message d'arrêt). Range ceux qu'on te fournit dans `<agent>.controls/samples/`, sans données réelles ni secrets : ils serviront de base aux fixtures. Si un format est défini dans la définition de l'agent elle-même, cette définition suffit.

Si un outil est autorisé sans raison apparente, signale-le : réduire les permissions est souvent le contrôle le moins cher. C'est une suggestion ; la modification de l'agent revient à l'utilisateur.

**Point d'arrêt.**

### Phase 2 — Inventorier les modes de défaillance

Lis `references/failure-modes.md` pour la méthode et la grille de gravité. Parcours systématiquement :

- chaque catégorie d'outil × chaque zone touchée (« que peut-il écrire de travers ici ? ») ;
- chaque livrable (« qu'est-ce qu'un livrable incomplet ou faux ? ») ;
- la fin de tâche (« peut-il déclarer fini sans l'être ? ») ;
- les actions irréversibles (suppression, exécution, appel externe).

Chaque mode : un identifiant `FM-NN`, une description observable (ce qu'on verrait dans le diff ou les commandes), une gravité `critical | high | medium | low`. Pas de mode vague du type « code de mauvaise qualité ».

Puis inventorie la **qualité des livrables** : lis `references/quality-criteria.md`. Pars des règles de la définition de l'agent, puis complète avec le catalogue générique ; n'utilise le contenu des skills chargés par l'agent ou d'un reviewer existant que si l'utilisateur te les fournit, sans jamais aller les chercher toi-même (complétude, fidélité, adéquation au destinataire, exploitabilité, conformité, robustesse, cohérence). Chaque défaut de qualité devient un mode `FM-NN`.

**Point d'arrêt.**

### Phase 3 — Classer les contrôles

Pour chaque mode de défaillance, pose la question : **peut-on écrire un test unitaire de ce contrôle ?**

- Oui → **hook**. Choisis l'événement :
  - empêcher l'action → `PreToolUse` (décision `deny`) ;
  - vérifier le résultat d'une action → `PostToolUse` (décision `block`, l'action a déjà eu lieu) ;
  - conditionner la fin du travail → `SubagentStop` ou `Stop`.
  - Préfère un contrôle prédéfini à un module `custom` : `deny-path`, `allow-paths` (liste blanche), `require-file`, `content` (motifs requis ou interdits dans un fichier écrit), `deny-command`, `run-command`, `require-changed` (livrables présents ou modifiés en fin de run), `append-only` (fichiers existants qui ne peuvent que grandir), `allow-command` (liste blanche de commandes).
  - Un contrôle ou un critère propre à un mode porte `only_in_modes`.
  - Un livrable structuré (JSON) se vérifie avec le contrôle `schema` et un JSON Schema rangé dans `schemas/`.
- Non → **critère du reviewer**, formulé comme une question fermée (réponse oui ou non), avec une **sévérité** (`blocker`, `high`, `medium`, `low`) et une **lentille**. Regroupe en lentilles les critères qui ont besoin des mêmes entrées, et donne à chacune les fichiers de référence qu'elle doit lire (`context`) : chaque lentille est un appel séparé qui ne voit que ses entrées. `block_on` fixe les sévérités qui bloquent ; les autres sont consignées comme observations.
  - Une lentille qui doit *chercher* dans le projet (vérifier qu'un fichier existe pour chaque élément d'une liste, par exemple) prend `access: project` ; sinon elle ne lit que ses entrées et son `context`.
  - Le reviewer peut répondre `inconclusive` quand les éléments manquent pour juger. `on_inconclusive` décide : `escalate` (par défaut : relancer l'agent n'apporterait pas l'information manquante), `block` ou `observe`.
  - Les définitions dont le reviewer a besoin pour juger (règles d'un skill, exemples de bons et mauvais livrables) vont dans `knowledge/` et sont déclarées dans `reviewer.knowledge`, éventuellement par lentille.

Règles de classement :

- Un mode `critical` doit être couvert par au moins un hook avec `on_error: block`. Si ce n'est vraiment pas possible, dis-le et justifie : le validateur émettra un avertissement.
- Un même mode peut être couvert par un hook et un critère (défense en profondeur).
- Chaque message de blocage a trois parties : problème, attendu, action. C'est ce que l'agent lira pour se corriger.
- Le reviewer reçoit au minimum le diff. Ne lui transmets jamais le raisonnement de l'agent.
- Recommande un modèle de reviewer différent de celui de l'agent quand c'est possible.
- **Ne base jamais un hook sur un format supposé.** Si la faisabilité d'un hook dépend du format d'un fichier dont tu n'as ni exemple ni définition, classe le contrôle en critère du reviewer et ajoute une entrée `deferred` qui décrit le hook envisagé et l'exemple nécessaire pour le durcir.
- Si l'agent a des sorties anticipées, déclare-les dans `blocked_exit` : sinon la revue refuse un arrêt légitime et l'agent tourne jusqu'à l'escalade.
- Si un mode change les règles, déclare-le dans `modes` avec les contrôles et critères qu'il désactive.
- Vérifie l'état final attendu de l'agent, pas celui d'un agent « standard » : un agent qui doit finir sur un test en échec ne se contrôle pas avec « les tests passent ».

Présente le résultat sous forme de matrice : mode → contrôle(s) → type → événement, et, pour le reviewer, critère → lentille → sévérité.

**Point d'arrêt.**

### Phase 4 — Écrire le contrat

Crée `<agent>.controls/` à côté du fichier de l'agent et écris `controls.yaml`. La structure est définie par `assets/controls.schema.json` ; `assets/example/` donne un exemple complet et valide (agent, contrat, module custom, fixtures). Lis `references/controls-schema.md` pour les règles qui dépassent le schéma. Renseigne `agent.source_sha256` avec l'empreinte du fichier analysé.

```bash
node <skill>/scripts/validate_controls.mjs <agent>.controls/controls.yaml
```

Corrige jusqu'à zéro erreur. Ne passe jamais à la phase 5 avec un contrat invalide. Présente les avertissements à l'utilisateur.

### Phase 5 — Générer le plugin

```bash
node <skill>/scripts/generate.mjs <agent>.controls/controls.yaml
```

Le générateur reconstruit `dist/<agent>/` entièrement : copie de l'agent convertie pour chaque client, consignes du reviewer, hooks dans les deux formats pour les clients listés, runtime, modules custom, contrat compilé, manifestes et README.

- Si l'empreinte du fichier agent ne correspond plus à `source_sha256`, le générateur s'arrête : l'agent a changé depuis l'analyse. Reprends à la phase 1.
- Ne modifie jamais un fichier de `dist/` à la main : modifie le contrat et régénère.
- Les modules `custom` s'écrivent dans `<agent>.controls/checks/`, selon l'interface décrite dans `references/controls-schema.md`.

### Phase 6 — Écrire et exécuter les fixtures

Pour chaque contrôle et pour le reviewer, écris au moins une fixture qui doit passer et une qui doit être bloquée, au format normalisé décrit dans `references/controls-schema.md`. Puis :

```bash
node <skill>/scripts/run_fixtures.mjs <agent>.controls/controls.yaml
```

Le runner exécute les fixtures **à travers les hooks du plugin généré**, pour chaque client ciblé, dans un dépôt Git temporaire. Il vérifie :

- la décision attendue, et que le blocage vient du bon contrôle (sa raison contient `[<id du contrôle>]`) ;
- l'isolation : le même appel venant d'un autre agent doit passer ;
- les invariants de sortie : au plus un objet JSON sur stdout, rien sur stderr, code de sortie 0 ;
- la latence réelle (démarrage de Node compris), p50 et p95, par rapport au budget du contrat.

**Deux sortes de fixtures pour le reviewer** :

- les fixtures **simulées** (`mock_verdict`) testent la mécanique : lentilles, validation du verdict, sévérités, escalade, rapport ;
- les fixtures **live** (`live: true`, sans `mock_verdict`) appellent réellement le reviewer et vérifient son *jugement*. Il en faut au moins une `allow` et une `block`. Leur projet doit être réaliste et complet (AC, contrats, plans, test, preuve RED crédibles) et passer tous les hooks : seul le reviewer doit pouvoir décider. Une fixture `block` vise un défaut que les hooks ne voient pas, et nomme le critère attendu avec `reason_contains`.

Avant d'écrire une fixture live, vérifie ce que chaque lentille recevra : `node <skill>/scripts/preview_review.mjs <controls.yaml> <fixture> [--lens <nom>]`. Une lentille dont le critère cite un fichier absent de ses entrées répondra `inconclusive`.

Les fixtures live sont jugées par le client lui-même, comme en usage réel : `node <skill>/scripts/live_review.mjs prepare <controls.yaml> <dossier>` crée un projet par fixture, dans l'état « revue en attente ». Ouvre le client dans chacun, plugin installé, et demande-lui de terminer : le verrou du thread principal impose de lancer les reviewers. Puis `live_review.mjs collect <controls.yaml> <dossier>` compare les résultats à l'attendu et écrit `<agent>.controls/.live-report.json`, avec l'empreinte du reviewer (agents reviewers, critères, lentilles, connaissances) : toute modification de ces éléments exige une nouvelle revue réelle.

Le résultat est écrit dans `<agent>.controls/.fixtures-report.json`, avec l'empreinte du plugin testé : le packaging le refuse si le plugin a changé depuis.

- Une fixture en échec révèle un contrôle faux ou une fixture fausse. Diagnostique lequel avant de corriger.
- **N'affaiblis jamais un contrôle pour faire passer une fixture** sans l'accord explicite de l'utilisateur.
- Un dépassement de budget se traite en priorité dans le contrôle (regroupement, contrôle prédéfini au lieu de `custom`), pas en relevant le budget.

### Phase 7 — Packager

```bash
node <skill>/scripts/package.mjs <agent>.controls/controls.yaml [--marketplace <dossier>]
```

Le packaging est un **gate**. Il échoue si :

- le dernier rapport de fixtures manque, a échoué, ne couvre pas toutes les fixtures ou a été obtenu sur un autre état du plugin (empreinte différente) ;
- un budget de latence est dépassé ;
- le plugin ne correspond plus au contrat, ou les manifestes, hooks et fichiers attendus sont incohérents ;
- le contenu a changé depuis la dernière version livrée sans que `plugin.version` augmente ;
- le reviewer n'a jamais été exécuté réellement, a changé depuis la dernière revue réelle, ou n'a pas donné les verdicts attendus sur les fixtures live. `--allow-unverified-reviewer` permet de livrer quand même, mais le plugin est alors marqué « revue réelle non vérifiée ».

En cas de succès, il enregistre la version livrée dans `<agent>.controls/.package-lock.json` et, avec `--marketplace <dossier>`, inscrit le plugin dans `<dossier>/.claude-plugin/marketplace.json` (lu par Claude Code et Copilot). En cas d'échec, reviens à la phase concernée ; ne contourne jamais le gate.

Ensuite, fais vérifier le chargement réel sur chaque client ciblé (commandes dans `references/plugin-format.md`) : le plugin doit apparaître, l'agent doit être listé (le reviewer, lui, ne l'est pas : il n'est appelé que par les hooks), et une action interdite doit être bloquée. Un plugin qui passe les fixtures mais ne se charge pas n'est pas prêt.

### Phase 8 — Restituer

Termine par une synthèse courte :

- la matrice de couverture finale (modes → contrôles) ;
- le résultat des fixtures et les latences par rapport au budget ;
- le nom et la version du plugin, et les commandes d'installation pour chaque client ;
- les contrôles reportés (`deferred`) et l'exemple qui permettrait de les durcir ;
- les sources de règles non fournies (`uncovered_sources`) et ce qui, de ce fait, n'est pas contrôlé ;
- les risques résiduels : modes couverts uniquement par le reviewer, avertissements du validateur, permissions de l'agent jugées trop larges ;
- si le fichier source de l'agent se trouve dans un dossier d'agents actif (`.claude/agents/`, `.github/agents/`), rappelle qu'il reste appelable **sans** ses contrôles tant qu'il y est ;
- comment lire les mesures : `node <plugin>/runtime/report.mjs` dans le projet (taux de blocage par contrôle, faux positifs, latences, tentatives avant validation, escalades, critères du reviewer les plus souvent en échec). `--blocks` liste les blocages, `--false-positive <id>` en annote un, `--by-version` compare les versions du plugin.

## Fonctionnement à l'exécution (pour expliquer à l'utilisateur)

- Les hooks référencent leurs scripts relativement à la racine du plugin. L'état du run et les logs sont écrits dans le **projet** où l'agent travaille (`.agent-controls/.runs/`), jamais dans le plugin, qui peut être en cache et remplacé à chaque mise à jour. Ce dossier contient son propre `.gitignore` : rien n'y est versionné, et le `.gitignore` du projet n'est jamais modifié.
- Les hooks d'un plugin se déclenchent pour toute la session, pas seulement pour son agent : le dispatcher identifie l'agent à l'origine de l'événement et n'applique les contrôles qu'à lui.
- Un hook qui bloque renvoie son message à l'agent, qui se corrige dans le même contexte.
- À la fin de l'agent contrôlé, le hook `SubagentStop` rejoue les contrôles sur les fichiers modifiés. S'ils échouent, l'agent est bloqué dans son contexte avec les points à corriger. S'ils passent, le runtime écrit un dossier de revue par lentille (entrées, critères, jeton, emplacement du verdict) et le run passe en « revue en attente ».
- Les reviewers sont des **agents du plugin**, un par lentille, exécutés par le client lui-même : ni CLI en mode script, ni SDK, ni clé d'API. Le thread principal ne peut pas conclure tant qu'ils n'ont pas rendu leur verdict : son `Stop` est bloqué, et au retour de chaque subagent un rappel lui donne la consigne exacte à transmettre. Un reviewer lancé sans son dossier est refusé.
- Un reviewer lit librement mais ne peut écrire que le `verdict.json` de son dossier ; toute autre écriture, commande ou délégation est refusée. Son verdict doit porter le jeton du dossier et répondre à tous les critères de la lentille, sinon il doit le réécrire. Le projet ne doit pas avoir changé pendant la revue.
- Quand toutes les lentilles ont rendu, le statut est **recalculé** à partir des findings : validé, **reprise demandée** (le thread principal doit relancer l'agent avec les points à corriger ; le nouveau run reprend la baseline et le compteur du précédent, pour que la revue suivante juge le travail cumulé) ou escalade.
- Après `max_iterations` refus, contrôles et revues confondus, le run passe en `escalated`, et le hook `Stop` du thread principal impose de présenter les findings à l'utilisateur.
- Tous les événements sont tracés en JSONL dans `.agent-controls/.runs/<run>/events.jsonl`.
- Désactiver le plugin retire l'agent et ses contrôles : c'est aussi le moyen de mesurer leur effet.

Le détail par client est dans `references/claude-code-hooks.md` et `references/copilot-hooks.md`. Lis uniquement celui des clients ciblés.

## Interface de sortie

Le skill contrôle un agent ; il n'orchestre pas le SDLC. Ce qu'un orchestrateur peut lire de l'extérieur :

- **Le rapport de run** (`report.path`, gabarit avec `{agent}`, `{date}`, `{run}`) : écrit dans le projet à chaque fin de subagent, avec le statut (`refused`, `passed`, `escalated`, `blocked`), l'itération, les contrôles en échec, le résultat de chaque lentille et les observations. Les rapports sont exclus du diff jugé.
- **Le signal d'escalade** : le `Stop` du thread principal présente les points en suspens et le chemin du rapport ; sous Copilot, la réponse du subagent renvoyée au parent porte en plus la mention `[agent-controls] ESCALADE`.

Décider de relancer l'agent, avec quel contexte, appartient à l'orchestrateur.

## Règles invariables

- Le fichier de l'agent fourni par l'utilisateur n'est **jamais** modifié.
- Les hooks n'écrivent **jamais** de logs sur stdout (réservé à la décision JSON) ni sur stderr (renvoyé à l'agent). Les logs vont dans un fichier.
- Un échec d'écriture de log ne casse jamais un contrôle.
- Aucune donnée sensible dans les fixtures ni dans les logs : chemins, noms d'outils et identifiants de contrôles uniquement. Les secrets sont masqués même en mode debug.
- Rien n'est écrit dans le dossier d'un plugin installé à l'exécution.
- Le reviewer est un agent exécuté par le client ; le skill ne lance jamais de modèle lui-même (ni CLI en mode script, ni SDK, ni API).
- Le dispatcher ne dépend jamais d'un plantage ou d'une expiration pour décider : il capture toute erreur, applique `on_error` et émet une décision explicite. Les deux clients se comportent à l'opposé en cas de panne (voir les références hooks).
- Sous Copilot, un contrôle `PostToolUse` ne peut pas bloquer : il est aussi rejoué au `SubagentStop` sur les fichiers modifiés.
- Un agent, un plugin.

## Modifier un contrat existant

Si `<agent>.controls/controls.yaml` existe déjà, ne repars pas de zéro. Lis-le, demande ce qui motive la modification (nouveau risque, faux positifs signalés dans le rapport, évolution de l'agent), puis reprends à la phase concernée : phase 1 si l'agent a changé, phase 2 pour un nouveau risque, phase 3 pour reclasser, phase 4 pour un ajustement. Incrémente `plugin.version`, régénère, relance toutes les fixtures et repackage.
