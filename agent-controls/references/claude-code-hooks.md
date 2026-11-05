# Hooks Claude Code

À lire quand le contrat cible `claude-code`. Ce document décrit ce que le générateur et le runtime doivent produire ; la référence officielle des hooks Claude Code fait foi en cas d'écart. Les points marqués **À vérifier** doivent être confirmés par le test de chargement réel en phase 7.

## Déclaration dans le plugin

Fichier `hooks/hooks.json`, référencé par `.claude-plugin/plugin.json`. Les scripts sont désignés via `${CLAUDE_PLUGIN_ROOT}` ; la racine du projet est disponible via `${CLAUDE_PROJECT_DIR}`.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Write|Edit|Bash",
        "hooks": [ { "type": "command",
                     "command": "node \"${CLAUDE_PLUGIN_ROOT}/runtime/dispatch.mjs\" claude PreToolUse",
                     "timeout": 5 } ] }
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit",
        "hooks": [ { "type": "command",
                     "command": "node \"${CLAUDE_PLUGIN_ROOT}/runtime/dispatch.mjs\" claude PostToolUse",
                     "timeout": 10 } ] }
    ],
    "SubagentStop": [
      { "matcher": "migration-writer",
        "hooks": [ { "type": "command",
                     "command": "node \"${CLAUDE_PLUGIN_ROOT}/runtime/dispatch.mjs\" claude SubagentStop",
                     "timeout": 180 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command",
                     "command": "node \"${CLAUDE_PLUGIN_ROOT}/runtime/dispatch.mjs\" claude Stop",
                     "timeout": 5 } ] }
    ]
  }
}
```

Règles du générateur :

- **Un dispatcher par événement**, qui exécute en interne tous les contrôles concernés.
- **Le `matcher` réduit les appels** (noms d'outils pour `PreToolUse`/`PostToolUse`, type d'agent pour `SubagentStop`), mais le dispatcher **revérifie toujours** l'agent et l'outil : le matcher est une optimisation, pas un contrôle.
- **`timeout` toujours explicite**, dérivé du budget du contrat avec une marge. Pour `SubagentStop`, il doit couvrir l'appel complet au reviewer.
- Le chemin est entre guillemets : les dossiers d'installation peuvent contenir des espaces, notamment sous Windows.

## Correspondance des outils

| Catégorie du contrat | Outils Claude Code |
|---|---|
| `file.read` | `Read`, `Glob`, `Grep` |
| `file.write` | `Write`, `Edit` |
| `shell.exec` | `Bash` |
| `web.fetch` | `WebFetch`, `WebSearch` |
| `subagent.spawn` | `Task` (selon les versions, `Agent`) |
| `mcp.call` | `mcp__<serveur>__<outil>` |

**À vérifier** : la liste exacte des outils d'écriture de ta version (outils d'édition multiple, de notebook) ; le générateur doit tous les inclure dans `file.write`, sinon un outil non listé contourne les contrôles.

## Entrée reçue par le hook

JSON sur stdin. Champs utilisés par le runtime :

| Champ | Usage |
|---|---|
| `hook_event_name` | événement |
| `session_id` | corrélation des logs et de l'état du run |
| `cwd` | racine du projet si `CLAUDE_PROJECT_DIR` est absent |
| `transcript_path` | jamais transmis au reviewer ; lecture limitée aux faits si `tool-facts` est demandé |
| `tool_name`, `tool_input` | `PreToolUse`, `PostToolUse` |
| `agent_id`, `agent_type` | présents quand le hook se déclenche **dans un subagent** ; c'est ce qui permet de n'appliquer les contrôles qu'à l'agent du plugin |
| `stop_hook_active` | `Stop`/`SubagentStop` : vrai si la continuation vient déjà d'un blocage par hook |

Conséquence importante : sans `agent_type`, l'événement vient du thread principal. Si l'agent du plugin peut aussi être utilisé comme agent principal, le runtime ne peut pas l'identifier par ce champ. **À vérifier** sur ta version, et à documenter dans le README du plugin.

## Sortie et décision

| Événement | Bloquer | Effet |
|---|---|---|
| `PreToolUse` | `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "…"}}` | l'outil n'est pas exécuté, la raison est renvoyée à l'agent |
| `PostToolUse` | `{"decision": "block", "reason": "…"}` | l'action a déjà eu lieu ; la raison est renvoyée à l'agent pour correction |
| `SubagentStop`, `Stop` | `{"decision": "block", "reason": "…"}` | l'agent ne s'arrête pas et reçoit la raison comme consigne |

Laisser passer : sortie vide ou `{}` avec code 0.

Un `deny` en `PreToolUse` s'applique avant les vérifications de permissions, y compris en mode de contournement des permissions : c'est ce qui en fait un vrai enforcement.

## Codes de sortie : le piège principal

| Code | Comportement Claude Code |
|---|---|
| `0` | stdout analysé comme JSON de décision |
| `2` | blocage ; stderr est renvoyé à l'agent |
| autre (dont `1`) | erreur **non bloquante** : l'action continue |

Un hook qui plante avec le code 1 **laisse donc passer**. Le runtime ne doit jamais dépendre du comportement en cas de plantage :

- tout le dispatcher est entouré d'un `try/catch` ;
- en cas d'erreur, il applique `on_error` du contrôle et **émet explicitement** la décision (JSON `deny`/`block`, code 0) ;
- il s'impose une échéance interne inférieure au `timeout` déclaré, pour décider lui-même plutôt que de subir l'expiration.

## Boucle du reviewer

Le reviewer est un ensemble d'agents du plugin (`agents/<agent>-review-<lentille>.md`, outils `Read, Grep, Glob, Write`), exécutés par Claude Code lui-même.

1. `SubagentStop` de l'agent contrôlé : contrôles rejoués ; s'ils passent, un dossier de revue par lentille est écrit sous `.agent-controls/.runs/<run>/review-<N>/<lentille>/` (`prompt.md`, emplacement de `verdict.json`, jeton), et le run passe en `awaiting_review`.
2. Thread principal : au retour du subagent, le hook `PostToolUse` sur `Task` bloque avec la consigne exacte (« lance tel reviewer avec : Dossier de revue : … ») ; le `Stop` reste bloqué tant que des lentilles sont en attente. Un `Task` vers un reviewer sans le bon dossier est refusé en `PreToolUse`.
3. Reviewer : `PreToolUse` n'autorise que l'écriture de son `verdict.json` ; à son `SubagentStop`, le verdict est lu, son jeton et ses critères vérifiés (deux tentatives), et le projet comparé au snapshot de début de revue.
4. À la dernière lentille : statut recalculé (validé, reprise demandée, escalade) et rapport de run écrit. En cas de reprise, le thread principal est bloqué jusqu'à ce qu'il relance l'agent ; le nouveau run hérite de la baseline et du compteur.

**À vérifier** (phase 7) : que les agents du plugin sont bien proposés au thread principal sous leur nom (préfixe d'espace de noms éventuel), et que le `PostToolUse` sur `Task` est bien déclenché au retour d'un subagent.

## Commandes de test (phase 7)

- Charger le plugin localement sans l'installer, puis vérifier dans `/hooks` que les quatre événements sont déclarés et dans `/agents` que l'agent et son reviewer sont listés.
- Demander à l'agent une action qu'un contrôle `PreToolUse` doit refuser, et vérifier le refus et sa raison.
- Vérifier l'apparition de `.agent-controls/.runs/<run>/events.jsonl` dans le projet.
