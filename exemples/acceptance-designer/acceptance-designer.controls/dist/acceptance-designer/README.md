# acceptance-designer 0.5.0

Agent `acceptance-designer` livré avec ses contrôles. Plugin généré par le skill agent-controls : ne pas éditer à la main.

## Installation

Claude Code : ajouter la marketplace qui référence ce dossier (`/plugin marketplace add <chemin-ou-dépôt>`), puis `/plugin install acceptance-designer@<marketplace>`.

Copilot CLI : `copilot plugin install <chemin-de-ce-dossier>`.

Prérequis : Node.js 18 ou plus, et un projet sous Git.

## Couverture

| Mode | Gravité | Défaillance | Contrôles |
|---|---|---|---|
| FM-01 | high | Écrit du comportement dans src/ au lieu de simples signatures pour faire compiler le test | reviewer C1 |
| FM-02 | high | Écrit sous tests/ un fichier autre que le test d'acceptance (tests unitaires internes, utilitaires) | CTRL-TEST-01 (PreToolUse) |
| FM-03 | high | Modifie un artefact amont : stories, ac-draft, contrats, event model, ADR, recherche | CTRL-UPSTREAM-01 (PreToolUse) |
| FM-04 | medium | Écrit hors des zones déclarées (.copilot-tracking/skraft-plans, tests, src) | CTRL-SCOPE-01 (PreToolUse) |
| FM-05 | medium | Place le test d'acceptance hors de tests/*.UnitTest/ (par exemple dans un projet IntegrationTest) | CTRL-TEST-02 (PreToolUse) |
| FM-06 | low | Écrit un Markdown de plan sans l'en-tête markdownlint-disable-file | CTRL-MD-01 (PostToolUse) |
| FM-07 | critical | Exécute une commande Git d'écriture (commit, push, reset --hard, clean) ou une suppression récursive | CTRL-SHELL-01 (PreToolUse) |
| FM-08 | medium | Ajoute une dépendance au projet (installation de paquet) | CTRL-SHELL-02 (PreToolUse) |
| FM-09 | high | Une valeur d'entrée ou de sortie du test diffère de celle du scénario (inventée, arrondie, modifiée) | CTRL-VAL-01 (SubagentStop), reviewer C2 |
| FM-10 | high | Écrit le test de plus d'un scénario, ou neutralise un test (Skip, Ignore) | CTRL-TEST-03 (PostToolUse), reviewer C3 |
| FM-11 | high | Utilise une assertion ou un stub factice (NotImplementedException, Assert.Fail) qui rend le RED vide de sens | CTRL-TEST-04 (PostToolUse) |
| FM-12 | high | Un critère d'acceptation de ac-draft n'a aucun scénario dans le .feature | reviewer C4 |
| FM-13 | medium | Le plan d'implémentation ne couvre pas tous les scénarios ou laisse une cellule à décider | reviewer C5 |
| FM-14 | high | Invente un cas métier absent de l'AC au lieu de l'escalader | reviewer C6 |
| FM-15 | high | Termine sans les livrables attendus (.feature, test-plan, impl-plan, test d'acceptance) | CTRL-DONE-01 (SubagentStop) |
| FM-16 | high | Le RED n'est pas prouvé : preuve absente, code de sortie 0, ou échec de compilation | CTRL-RED-01 (SubagentStop), reviewer C7 |
| FM-17 | medium | S'arrête en « bloqué » pour un artefact manquant qui existe pourtant |  |
| FM-18 | medium | En mode rework, modifie des artefacts non cités dans les findings | reviewer C8 |
| FM-19 | medium | Le .feature ne respecte pas le format : nom, structure Gherkin, un tag de type par scénario, au moins un @happy-path | CTRL-FEAT-02 (PostToolUse), CTRL-FEAT-03 (PreToolUse) |
| FM-20 | medium | Les étapes Given/When/Then contiennent du vocabulaire technique | CTRL-FEAT-01 (PostToolUse), reviewer C11 |
| FM-21 | high | Une valeur d'un scénario diffère de celle de l'AC source | reviewer C9 |
| FM-22 | medium | Les cas limites ou négatifs des exemples de l'AC ne sont pas représentés | reviewer C10 |
| FM-23 | medium | Une étape est ambiguë ou non implémentable telle quelle | reviewer C12 |
| FM-24 | high | Un scénario du plan de tests ne cible pas le use case de couche Application nommé dans les contrats | reviewer C14 |
| FM-25 | medium | Aucun scénario walking skeleton n'est identifié pour un flux | reviewer C15 |
| FM-26 | high | Un use case nouveau n'a pas de test de couche Application, seulement un test d'intégration | reviewer C13 |

## Contrôles à durcir

Couverts aujourd'hui par le reviewer ; un hook déterministe est envisagé dès qu'un exemple sera disponible.

| Id | Modes | Hook envisagé | Il manque |
|---|---|---|---|
| DEF-01 | FM-12 | Hook SubagentStop : chaque AC de ac-draft a un scénario, et chaque titre de scénario commence par une persona des stories | un exemple de ac-draft-{story}.md et de stories-{milestone}.md produits par Skraft |
| DEF-02 | FM-15, FM-04 | Inclure le JSON de forecast dans les livrables exigés et dans la liste blanche d'écriture | un exemple de consigne de délégation précisant le dossier de sortie du forecast |
| DEF-03 | FM-18 | Détection fiable du mode rework et contrôle déterministe des fichiers modifiés contre ceux cités dans les findings | un exemple de bloc de handoff en mode rework et du fichier de findings |

## Fonctionnement

- Les contrôles ne s'appliquent qu'à l'agent `acceptance-designer` utilisé comme subagent. Les autres agents de la session ne sont pas affectés.
- À la fin de l'agent, les contrôles sont rejoués sur les fichiers modifiés, puis un reviewer en lecture seule évalue le travail. Après 3 tentatives refusées, le travail est escaladé vers l'utilisateur.
- Mesures et logs : `.agent-controls/.runs/` dans le projet (non versionné). Rapport : `node <plugin>/runtime/report.mjs`.
- Désactiver le plugin retire l'agent et ses contrôles.

## Limites connues

- Copilot : un contrôle `PostToolUse` ne bloque pas immédiatement ; il est imposé à la fin de l'agent.
- Copilot : un agent du projet portant le même nom masque celui du plugin ; les contrôles s'appliquent alors à la définition du projet.
- Copilot cloud agent : les plugins n'y sont pas chargés, aucun contrôle ne s'y applique.
