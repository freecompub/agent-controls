# agent-controls — livraison

Skill qui, à partir du fichier `.md` d'un agent, génère un plugin prêt à l'emploi pour **Claude Code** et **GitHub Copilot** : l'agent, ses contrôles déterministes (hooks) et ses reviewers (agents du plugin, exécutés par le client — ni CLI en mode script, ni SDK, ni API).

## Contenu

| Élément | Rôle |
|---|---|
| `agent-controls.skill` | le skill packagé, à installer |
| `agent-controls/` | les sources du skill (SKILL.md, références, schémas, scripts, runtime, exemple) |
| `exemples/acceptance-designer/` | agent Skraft, contrat, modules, fixtures et plugin généré |
| `exemples/solution-architect/` | idem — copie locale de l'agent avec `Bash` ajouté (oubli de la définition d'origine) |

## Utilisation (depuis le dossier qui contient l'agent)

```bash
node <skill>/scripts/inspect_agent.mjs mon-agent.md                       # phase 1
node <skill>/scripts/validate_controls.mjs mon-agent.controls/controls.yaml   # phase 4
node <skill>/scripts/generate.mjs mon-agent.controls/controls.yaml            # phase 5
node <skill>/scripts/run_fixtures.mjs mon-agent.controls/controls.yaml        # phase 6 — mécanique
node <skill>/scripts/preview_review.mjs mon-agent.controls/controls.yaml <fixture>   # ce que reçoit chaque reviewer
node <skill>/scripts/live_review.mjs prepare mon-agent.controls/controls.yaml ./live  # phase 6 — revue réelle, puis :
#   ouvrir le client dans chaque projet de ./live, plugin installé, et lui demander de terminer
node <skill>/scripts/live_review.mjs collect mon-agent.controls/controls.yaml ./live
node <skill>/scripts/package.mjs mon-agent.controls/controls.yaml [--marketplace <dossier>]   # phase 7 — gate
node <plugin>/runtime/report.mjs                                              # mesures, dans le projet
```

## État des exemples

| Agent | Modes de défaillance | Hooks | Critères (reviewers) | Fixtures | Gate |
|---|---|---|---|---|---|
| acceptance-designer | 26 | 15 | 15 (5 lentilles) | 102/102 | refusé : revue réelle à faire |
| solution-architect | 31 | 16 | 15 (2 reviewers) | 112/112 | refusé : revue réelle à faire |

Le refus du gate est attendu : le jugement des reviewers n'a pas encore été exécuté dans un vrai client (`live_review.mjs`).

## À vérifier en conditions réelles (phase 7)

- Nom sous lequel le client présente les agents du plugin (préfixe d'espace de noms éventuel).
- `PostToolUse` sur `Task` au retour d'un subagent (Claude Code).
- Expansion de `${PLUGIN_ROOT}` dans les commandes de hooks des plugins Copilot.
- Lecture du message final d'un subagent sous Claude Code (arrêts bloqués), via le transcript.
- Fiabilité du thread principal à lancer les reviewers avec la consigne exacte.

## Décisions en attente

- **solution-architect** : modèle du reviewer (Opus comme l'agent, ou un autre) ; critère C9 dépendant du skill non fourni `adr-eligibility-gate`.
- **acceptance-designer** : passer de cinq lentilles à deux reviewers (« spécification » / « implémentation »), selon la règle « un seul reviewer, découpage justifié ».
- Les deux : fixer le modèle du reviewer pour Copilot ; échantillonnage humain des runs validés pour mesurer les faux négatifs.
