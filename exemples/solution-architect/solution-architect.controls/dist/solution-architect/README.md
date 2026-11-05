# solution-architect 0.1.0

Agent `solution-architect` livré avec ses contrôles. Plugin généré par le skill agent-controls : ne pas éditer à la main.

## Installation

Claude Code : ajouter la marketplace qui référence ce dossier (`/plugin marketplace add <chemin-ou-dépôt>`), puis `/plugin install solution-architect@<marketplace>`.

Copilot CLI : `copilot plugin install <chemin-de-ce-dossier>`.

Prérequis : Node.js 18 ou plus, et un projet sous Git.

## Couverture

| Mode | Gravité | Défaillance | Contrôles |
|---|---|---|---|
| FM-01 | high | Écrit du code ou des tests (src/, tests/) | CTRL-CODE-01 (PreToolUse) |
| FM-02 | high | Modifie un artefact amont : stories, ac-draft, recherche, structural-scan.json | CTRL-UPSTREAM-01 (PreToolUse) |
| FM-03 | high | Modifie un contenu existant de docs/adr/ (ADR, supersessions.md, decisions-index.md) au-delà des lignes de statut | CTRL-ADR-02 (PostToolUse) |
| FM-04 | high | Se ratifie lui-même : nouvel ADR non Proposed, ou bascule de statut sans verdict humain | CTRL-ADR-04 (PostToolUse), reviewer C14 |
| FM-05 | medium | Écrit hors de .copilot-tracking/skraft-plans/ et docs/adr/ | CTRL-SCOPE-01 (PreToolUse) |
| FM-06 | low | Markdown sans l'en-tête markdownlint-disable-file | CTRL-MD-01 (PostToolUse) |
| FM-07 | critical | Lance une commande autre que git commit -s, le rendu artifact.mjs adr ou une lecture Git | CTRL-SHELL-01 (PreToolUse) |
| FM-08 | medium | Commit non conforme : sans -s, ou avec Closes #N en phase DESIGN | CTRL-SHELL-01 (PreToolUse), CTRL-SHELL-02 (PreToolUse) |
| FM-09 | high | Écrit un ADR à la main : en-tête YAML absent ou incomplet | CTRL-ADR-03 (PostToolUse) |
| FM-10 | high | Numérote les nouveaux ADR avec un trou ou un doublon | CTRL-ADR-05 (SubagentStop) |
| FM-11 | high | Nomme un ADR hors du format docs/adr/adr-NNN-slug.md | CTRL-ADR-01 (PreToolUse) |
| FM-12 | high | Termine sans event model, diagrammes, contrats, context map ou matrice de cohérence | CTRL-DONE-01 (SubagentStop) |
| FM-13 | high | Produit des artefacts alors qu'un blocker sans résolution humaine existait | CTRL-BLOCK-01 (SubagentStop) |
| FM-14 | medium | S'arrête en missing_artefact sans raison (artefact présent, ou fichiers déjà écrits) |  |
| FM-15 | high | Matrice non PASS sans fichier de blocker, ou blocker sans matrice en échec | CTRL-MATRIX-01 (SubagentStop) |
| FM-16 | medium | En mode rework, modifie des artefacts non cités dans les findings | reviewer C15 |
| FM-17 | high | Une story n'a aucun déclencheur (commande ou requête) dans l'event model | reviewer C1 |
| FM-18 | high | Une commande n'a pas d'événement, ou une requête en lève un | reviewer C2 |
| FM-19 | medium | Un événement n'est pas nommé au passé, ou n'est pas levé par une racine d'agrégat | reviewer C3 |
| FM-20 | medium | Un sous-domaine n'est pas classé, ou une relation entre contextes n'a pas de pattern explicite | reviewer C4 |
| FM-21 | high | Une interface de repository est en Infrastructure, ou sa couche diffère entre ADR, diagrammes et contrats | reviewer C5 |
| FM-22 | medium | Un nœud de diagramme ne porte aucune des étiquettes imposées | CTRL-DIAG-01 (PostToolUse) |
| FM-23 | high | Un agrégat, un contexte ou un pattern est introduit sans story qui le justifie | reviewer C6 |
| FM-24 | medium | Un composant est créé alors que la recherche indiquait un existant réutilisable | reviewer C7 |
| FM-25 | high | ADR pour un candidat inéligible, ou engagement structurel sans ADR | reviewer C9 |
| FM-26 | high | ADR qui échoue à son contrôle de qualité (décision non unique, sans forces, sans conséquence négative, alternatives de façade) | reviewer C10 |
| FM-27 | high | Pattern complexe ratifié sans force admissible ni alternative sans le pattern | reviewer C11 |
| FM-28 | medium | ADR qui ratifie une convention de base du projet | reviewer C12 |
| FM-29 | high | Supersession incomplète : ligne Supersedes, ligne du registre ou plan non réalisé | CTRL-SUPERSEDE-01 (SubagentStop) |
| FM-30 | high | Contrat incomplet : commande sans validation, requête sans retour, événement sans payload, interface sans couche | reviewer C8 |
| FM-31 | high | Matrice de cohérence absente, sans ligne consistency-gate, ou qui ne reflète pas les artefacts | CTRL-MATRIX-01 (SubagentStop), reviewer C13 |

## Contrôles à durcir

Couverts aujourd'hui par le reviewer ; un hook déterministe est envisagé dès qu'un exemple sera disponible.

| Id | Modes | Hook envisagé | Il manque |
|---|---|---|---|
| DEF-01 | FM-16, FM-04 | Détecter les modes rework et ratification de façon fiable | un exemple de bloc de handoff pour chaque mode |
| DEF-02 | FM-31 | Recalculer la matrice de cohérence et la comparer à celle de l'agent | la table de normalisation de l'asset consistency-matrix |
| DEF-03 | FM-21, FM-30 | Vérifier la couche de chaque interface dans les contrats | un exemple de fichier contracts-{story}.md |
| DEF-04 | FM-12, FM-17 | Exiger les livrables et un déclencheur pour chaque story | le format des identifiants de story dans stories-{milestone}.md |

## Règles non couvertes

L'agent s'appuie sur ces sources, qui n'ont pas été fournies pour construire les contrôles : leurs règles ne sont vérifiées ni par les hooks ni par les reviewers.

| Source | Type | Ce qui n'est pas contrôlé |
|---|---|---|
| architecture-patterns | skill | règles DDD et Clean Architecture générales (règle de dépendance, invariants entre agrégats, conventions d'interfaces) |
| architecture-decisions | skill | gabarit d'ADR, règles de ratification et de supersession au-delà de ce que dit le prompt |
| adr-eligibility-gate | skill | les cinq questions d'éligibilité d'un ADR |
| clean-architecture-<language> | skill | conventions de couches propres au langage du projet |
| consistency-matrix (asset) | document | table de normalisation des étiquettes : la matrice n'est pas recalculée |

## Fonctionnement

- Les contrôles ne s'appliquent qu'à l'agent `solution-architect` utilisé comme subagent. Les autres agents de la session ne sont pas affectés.
- À la fin de l'agent, les contrôles sont rejoués sur les fichiers modifiés, puis un reviewer en lecture seule évalue le travail. Après 3 tentatives refusées, le travail est escaladé vers l'utilisateur.
- Mesures et logs : `.agent-controls/.runs/` dans le projet (non versionné). Rapport : `node <plugin>/runtime/report.mjs`.
- Désactiver le plugin retire l'agent et ses contrôles.

## Limites connues

- Copilot : un contrôle `PostToolUse` ne bloque pas immédiatement ; il est imposé à la fin de l'agent.
- Copilot : un agent du projet portant le même nom masque celui du plugin ; les contrôles s'appliquent alors à la définition du projet.
- Copilot cloud agent : les plugins n'y sont pas chargés, aucun contrôle ne s'y applique.
