# Contrat de contrôles : règles, fixtures et modules custom

À lire en phases 4 à 6. La structure de `controls.yaml` est définie par `assets/controls.schema.json` ; ce document couvre ce que le schéma ne peut pas exprimer.

## Règles vérifiées par `validate_controls.mjs`

Le schéma JSON valide la forme. Le validateur ajoute ces règles.

**Erreurs (bloquantes)**

| Règle | Exemple de violation |
|---|---|
| Identifiants uniques (`FM-`, `CTRL-`, `C`) | deux contrôles `CTRL-MIG-01` |
| Chaque `covers` référence un mode existant | `covers: [FM-09]` sans `FM-09` |
| Chaque mode est couvert au moins une fois | `FM-04` absent de tous les `covers` |
| Chaque contrôle a au moins une fixture qui passe et une qui bloque | deux fixtures `deny` |
| `expect` cohérent avec l'événement | `deny` sur un `PostToolUse` |
| Fichiers de fixtures et modules `custom` présents | `checks/x.mjs` introuvable |
| Expressions régulières de `deny-command` compilables | parenthèse non fermée |
| `match.paths` présent si `check` en a besoin | `require-file` sans `paths` |
| Empreinte `agent.source_sha256` conforme au fichier agent | agent modifié depuis l'analyse |

**Avertissements (à présenter à l'utilisateur)**

| Règle | Pourquoi |
|---|---|
| Mode `critical` couvert seulement par le reviewer | le jugement LLM n'est pas un enforcement |
| Mode `critical` couvert par un hook `on_error: allow` | une panne du contrôle laisse passer |
| `PostToolUse` ciblant Copilot | Copilot ne peut pas bloquer en `PostToolUse` (voir `copilot-hooks.md`) |
| Reviewer sur le même modèle que l'agent | risque d'auto-complaisance |
| Plus de 20 modes | inventaire à regrouper |

## Contrôles prédéfinis

| Type | Rôle | Événement conseillé |
|---|---|---|
| `deny-path` | refuse l'écriture sur les chemins listés | PreToolUse |
| `allow-paths` | parmi les chemins visés par `match.paths` (ou tous), refuse ceux hors de la liste | PreToolUse |
| `require-file` | exige un fichier dérivé du chemin écrit (`plans/{basename}.md`) | PreToolUse |
| `content` | `require` : motifs qui doivent apparaître ; `forbid` : motifs interdits (ligne indiquée) | PostToolUse (fichier complet) |
| `deny-command` | refuse une commande shell correspondant à un motif | PreToolUse |
| `run-command` | lance une commande sur le fichier écrit ; code non nul = échec | PostToolUse |
| `require-changed` | chaque motif doit correspondre à au moins un fichier, modifié pendant le run (`scope: changed`) ou présent (`scope: present`) | SubagentStop uniquement |
| `schema` | le fichier écrit est un JSON valide contre `schemas/*.json` (embarqué dans le plugin) | PostToolUse ou SubagentStop |
| `append-only` | un fichier qui existait au début du run ne peut que grandir : lignes existantes identiques et à leur place, sauf celles qui correspondent à `allow_changed` | PostToolUse ou SubagentStop |
| `allow-command` | liste blanche : la première ligne de la commande doit correspondre à un motif ; tout enchaînement (`&&`, `;`, `|`, `$(…)`) est refusé | PreToolUse |
| `custom` | module `checks/*.mjs` ; reçoit aussi `baseline` (`exists`, `read`, `list` : le projet au début du run) et `changed` | tous |

`only_in_modes: [rework]` sur un contrôle ou un critère le rend actif seulement dans ces modes.

Le modèle du reviewer peut être une chaîne, ou un objet par client (`{ claude: opus, copilot: … }`), puisque les identifiants diffèrent.

## Réponse « indéterminé » et rapport de run

Le verdict accepte `answer: inconclusive`, avec une `evidence` qui dit ce qui manque. `reviewer.on_inconclusive` : `escalate` (défaut), `block` ou `observe`. Une fixture de reviewer peut vérifier le statut final du run avec `expect_status` (`passed`, `running`, `escalated`, `blocked`).

`report.path` active le rapport de run (JSON). Le runner de fixtures vérifie qu'il est écrit à chaque fin de run.

```json
{ "version": 1, "agent": "acceptance-designer", "plugin_version": "0.3.0", "run": "5859a84480c66ebd",
  "status": "refused", "iteration": 1, "max_iterations": 3, "mode": null,
  "controls": [{ "id": "CTRL-DONE-01", "message": "…" }],
  "lenses": [{ "name": "coverage", "status": "fail", "findings": [{ "criterion": "C9", "severity": "blocker", "answer": "no", "question": "…", "evidence": [] }] }],
  "observations": [] }
```

## Vérifier un arrêt bloqué

`blocked_exit.check` désigne un module qui reçoit le message final, la liste des fichiers modifiés et un accès en lecture au projet, et dit si l'arrêt est justifié. Il porte ses propres `covers` et `fixtures` (avec `final_message`). Une erreur du module vaut un arrêt injustifié.

## Contrôles reportés

`deferred` trace les hooks envisagés mais non écrits, faute d'exemple du format dont ils dépendent. Une entrée ne couvre aucun mode de défaillance : le mode doit rester couvert par un contrôle ou un critère du reviewer. Le validateur les liste en avertissement, et le README du plugin les présente dans « Contrôles à durcir ».

```yaml
deferred:
  - id: DEF-01
    covers: [FM-12a]
    planned: "PostToolUse sur le .feature : chaque AC de ac-draft a au moins un scénario"
    needs: "un exemple de ac-draft-{story}.md (format des identifiants d'AC)"
```

Quand l'exemple arrive : range-le dans `samples/`, écris le hook et ses fixtures à partir de lui, retire l'entrée `deferred`.

## Sortie bloquée et modes

**`blocked_exit`** déclare les arrêts légitimes sans livrable. Le message final de l'agent est testé contre `patterns` (expressions régulières). S'il correspond, la revue est sautée et le run est marqué `blocked`. Avec `require_no_changes: true` (par défaut), un arrêt bloqué qui a pourtant modifié des fichiers est refusé.

```yaml
blocked_exit:
  patterns: ['"status"\s*:\s*"blocked"', '^RECONCILIATION NEEDED']
  require_no_changes: true
```

Le message final vient du payload sous Copilot (`last_assistant_message`) et du transcript sous Claude Code (**À vérifier** : emplacement du transcript d'un subagent).

`allowed_changes` (globs) précise ce qu'un arrêt bloqué peut avoir écrit, par exemple un fichier de blocker ; le module `blocked_exit.check` reçoit aussi `baseline` pour juger un arrêt qui réémet un blocker existant.

**`modes`** déclare des variantes reconnues dans la consigne de délégation. Le mode est fixé à l'ouverture du run ; ses contrôles et critères `disable` ne s'appliquent pas. Si la consigne n'a pas été capturée, aucun mode n'est actif : les règles complètes s'appliquent, ce qui est le choix sûr.

```yaml
modes:
  - name: rework
    task_pattern: '(?im)^mode:\s*rework'
    disable: [C1]
```

Fixtures associées : `final_message` simule le message final, `task` la consigne. Pour prouver qu'une sortie bloquée saute la revue, donne-lui un `mock_verdict` **négatif** et attends `allow` : un verdict positif passerait même si la revue avait tourné.

## Correspondance `expect` / événement

| Événement | Valeurs de `expect` |
|---|---|
| `PreToolUse` | `allow`, `deny` |
| `PostToolUse` | `allow`, `block` |
| `SubagentStop`, `Stop` | `allow`, `block` |
| Reviewer | `allow`, `block` |

## Gabarits dans les contrôles prédéfinis

Utilisables dans `require-file.path`, `run-command.command` et les messages :

| Gabarit | Valeur pour `migrations/2026/0042_add_dose.sql` |
|---|---|
| `{path}` | `migrations/2026/0042_add_dose.sql` |
| `{dir}` | `migrations/2026` |
| `{basename}` | `0042_add_dose` |
| `{ext}` | `.sql` |

Les chemins sont toujours relatifs à la racine du projet, avec `/` comme séparateur sur toutes les plateformes ; le runtime normalise les chemins Windows.

## Format des fixtures

Une fixture est un fichier JSON **indépendant du client**. Le runner la traduit dans le payload de chaque client ciblé et vérifie que la décision est la même partout.

```json
{
  "event": "PreToolUse",
  "agent": "migration-writer",
  "tool": "file.write",
  "input": { "path": "migrations/0042_add_dose.sql", "content": "ALTER TABLE …" },
  "project": {
    "files": { "plans/0042_add_dose.md": "# Plan\n…" }
  }
}
```

| Champ | Rôle |
|---|---|
| `event` | événement simulé |
| `agent` | agent à l'origine de l'événement ; une fixture avec un autre agent vérifie que les contrôles **ne** s'appliquent **pas** |
| `tool` | catégorie d'outil |
| `input.path`, `input.content` | pour `file.read` / `file.write` |
| `input.command` | pour `shell.exec` |
| `project.files` | état du projet simulé : le runner crée un dépôt Git temporaire contenant ces fichiers |

Le contenu des fixtures est fictif : jamais de données réelles, de secrets ni d'extraits de production.

### Fixtures du reviewer

Le reviewer est un LLM : une fixture qui l'appellerait réellement serait lente, coûteuse et non déterministe. On sépare donc deux choses.

**Fixtures de la boucle (déterministes, obligatoires)** : on fournit le verdict au lieu d'appeler le modèle, et on teste tout ce qui l'entoure — construction du dossier de preuves, validation du verdict, blocage, compteur d'itérations, escalade.

```json
{
  "event": "SubagentStop",
  "agent": "migration-writer",
  "task": "Ajoute la colonne dose_max à la table protocols",
  "project": { "baseline": { "migrations/0041.sql": "…" }, "files": { "migrations/0042.sql": "…" } },
  "mock_verdict": { "criteria": [ { "id": "C1", "answer": "no", "evidence": [ { "path": "plans/0042.md", "note": "rollback absent" } ] } ] },
  "iteration": 1
}
```

Cas à couvrir au minimum : verdict positif, verdict négatif, verdict mal formé (doit bloquer), dernière itération (doit escalader).

Le projet d'une fixture du reviewer est construit en deux temps : `project.baseline` est l'état au démarrage de l'agent, `project.files` ce qu'il a écrit ensuite. Les contrôles `PostToolUse` sont rejoués sur ces fichiers avant la revue : la baseline doit donc contenir ce dont ils ont besoin (un script de lint, par exemple), sinon la fixture échoue pour une autre raison que celle testée.

### Vérifier la raison du blocage

Pour une fixture de contrôle qui doit bloquer, le runner exige que la raison contienne `[<id du contrôle>]` : un blocage provoqué par un autre contrôle est un échec. Pour les fixtures du reviewer, ou pour être plus précis, ajoute `"reason_contains": "[C1]"` à la fixture.

**Fixtures de jugement (réelles, obligatoires)** : marquées `"live": true`, sans `mock_verdict`. Il en faut au moins une `allow` et une `block`. Elles sont jugées par le client lui-même : `live_review.mjs prepare` crée les projets en attente de revue, tu ouvres le client dans chacun, puis `live_review.mjs collect` écrit le rapport que le gate exige. Leur projet doit passer tous les hooks, pour que seul le jugement du reviewer décide ; `preview_review.mjs` montre ce que chaque reviewer recevra.

Pour une fixture de reviewer (simulée ou live), `expect` désigne la décision finale du thread principal : `allow` = travail validé, `block` = reprise demandée ou escalade. `expect_status` précise : `passed`, `rework_required`, `escalated`.

## Interface des modules `custom`

Un module `custom` est un fichier ES module dans `checks/`, sans dépendance :

```js
// checks/deny-applied-migration.mjs
export default async function check(ctx) {
  // ctx.event     : 'PreToolUse' | 'PostToolUse' | 'SubagentStop' | 'Stop'
  // ctx.tool      : catégorie, ex. 'file.write'
  // ctx.input     : { path?, content?, command? } normalisé
  // ctx.projectDir: racine du projet
  // ctx.params    : params du contrat
  // ctx.agent     : nom de l'agent
  // ctx.fs        : lecture seule (readText, exists, list)
  return { ok: true };
  // ou { ok: false, details: 'migrations/0041.sql est déjà appliquée' }
}
```

Règles :

- **Aucune écriture** sur stdout ni stderr, aucune écriture de fichier. Le module ne fait que lire et décider.
- **Déterministe** : même entrée, même résultat. Pas d'appel réseau, pas d'aléatoire, pas d'horloge.
- **Rapide** : le runner mesure chaque module ; un module qui dépasse le budget fait échouer la phase 6.
- Une exception levée est traitée selon `on_error` du contrôle, jamais comme un succès implicite.
- `details` est ajouté au message de blocage ; il doit aider l'agent à se corriger.
