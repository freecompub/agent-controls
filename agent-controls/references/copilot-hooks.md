# Hooks GitHub Copilot

À lire quand le contrat cible `copilot-cli` ou `copilot-vscode`. Source : la référence officielle des hooks GitHub Copilot, qui fait foi en cas d'écart. Les points marqués **À vérifier** doivent être confirmés par le test de chargement réel en phase 7.

## Surfaces

| Surface | Hooks | Remarques |
|---|---|---|
| Copilot CLI | tous les événements | cible principale |
| Copilot VS Code | en préversion | lit aussi le format Claude des plugins |
| Copilot cloud agent | sous-ensemble | ne charge pas les plugins installés : seuls les hooks `.github/hooks/*.json` du dépôt s'y appliquent. Un plugin n'y apporte **aucun** contrôle. |

## Déclaration dans le plugin

Fichier référencé par le champ `hooks` du `plugin.json` racine. Format :

```json
{
  "version": 1,
  "hooks": {
    "PreToolUse": [
      { "type": "command", "matcher": "Write|Edit|Bash",
        "command": "node \"${PLUGIN_ROOT}/runtime/dispatch.mjs\" copilot PreToolUse",
        "timeoutSec": 5 }
    ],
    "SubagentStop": [
      { "type": "command",
        "command": "node \"${PLUGIN_ROOT}/runtime/dispatch.mjs\" copilot SubagentStop",
        "timeoutSec": 180 }
    ],
    "Stop": [
      { "type": "command",
        "command": "node \"${PLUGIN_ROOT}/runtime/dispatch.mjs\" copilot Stop",
        "timeoutSec": 5 }
    ]
  }
}
```

Choix du générateur :

- **Noms d'événements en PascalCase** (`PreToolUse`, `SubagentStop`, `Stop`). Copilot fournit alors un payload aux champs snake_case compatible avec celui de Claude Code, et applique la sémantique de matcher de Claude : un seul parseur dans le runtime.
- **`command` plutôt que `bash`/`powershell`** : c'est le champ multiplateforme, utilisé sur Windows, macOS et Linux.
- **`timeoutSec` toujours explicite** : la valeur par défaut est de 30 secondes, insuffisante pour un reviewer.

**À vérifier** : l'expansion de `${PLUGIN_ROOT}` (ou de ses alias `${COPILOT_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_ROOT}`) dans la commande d'un hook de plugin. Elle est documentée pour les serveurs MCP et LSP des plugins, pas explicitement pour les hooks. Si elle ne fonctionne pas, le test de phase 7 échoue et il faut trouver un autre moyen de localiser le runtime avant de livrer le plugin pour Copilot.

## Correspondance des outils

Avec les événements en PascalCase, Copilot rapporte les noms d'outils au format Claude :

| Outil Copilot | Nom rapporté | Catégorie du contrat |
|---|---|---|
| `view` | `Read` | `file.read` |
| `grep`, `rg` | `Grep` | `file.read` |
| `glob` | `Glob` | `file.read` |
| `create` | `Write` | `file.write` |
| `edit`, `str_replace_editor`, `apply_patch` | `Edit` | `file.write` |
| `bash`, `powershell` | `Bash` | `shell.exec` |
| `web_fetch`, `web_search` | `WebFetch`, `WebSearch` | `web.fetch` |
| `task` | `Agent` (ou `Task`) | `subagent.spawn` |

Les outils sans équivalent Claude gardent leur nom Copilot : le générateur doit les lister explicitement s'ils écrivent.

## Identification de l'agent

Les hooks déclenchés **dans un subagent** reçoivent en plus `agent_id`, `agent_type` et `parent_agent_id`. `SubagentStop` fournit aussi `agent_name` et `last_assistant_message` (réponse finale du subagent). `SubagentStart` accepte un `matcher` sur le nom de l'agent et peut injecter du contexte, mais ne peut pas bloquer.

Limite : l'agent intégré `general-purpose` n'émet ni `SubagentStart` ni `SubagentStop`. Ce n'est pas un problème pour un agent de plugin, mais le README doit le mentionner.

## Sortie et décision

| Événement | Bloquer | Différence avec Claude Code |
|---|---|---|
| `PreToolUse` | `{"permissionDecision": "deny", "permissionDecisionReason": "…"}` | champs à la racine, pas dans `hookSpecificOutput` |
| `PostToolUse` | **impossible** | seul `additionalContext` est possible : c'est un nudge, pas un blocage |
| `SubagentStop`, `Stop` | `{"decision": "block", "reason": "…"}` | identique ; garde-fou à 8 blocages consécutifs |

Le dispatcher produit la sortie au format du client indiqué par son premier argument (`claude` ou `copilot`).

Stdout doit contenir **un seul** objet JSON de décision. Deux objets concaténés rendent la sortie invalide, et elle est alors ignorée.

## `PostToolUse` : compenser l'absence de blocage

Un contrôle `PostToolUse` ne peut pas forcer de correction sous Copilot. Le générateur applique donc cette règle :

1. Le contrôle est déclaré en `PostToolUse` avec `additionalContext` : l'agent est informé tout de suite.
2. Le même contrôle est **rejoué au `SubagentStop`** sur tous les fichiers modifiés depuis la baseline. S'il échoue encore, la fin du subagent est bloquée.

Le contrôle reste donc imposé, simplement plus tard. Le validateur émet un avertissement pour que l'utilisateur le sache.

## Pannes et expirations : comportements opposés à Claude Code

| Situation | Copilot `PreToolUse` | Claude Code |
|---|---|---|
| Plantage ou code de sortie non nul | **refus** (fail-closed) | laisse passer (code ≠ 2) |
| Expiration du délai | **laisse passer** (fail-open) | selon le client |

Les deux clients divergent ; d'où la règle du runtime, valable partout : ne jamais dépendre du plantage ni de l'expiration. Le dispatcher capture toute erreur, applique `on_error`, émet une décision explicite avec le code 0, et s'impose une échéance interne inférieure à `timeoutSec`.

## Boucle du reviewer

Identique à celle décrite dans `claude-code-hooks.md` : reviewers en agents du plugin (`copilot/agents/<agent>-review-<lentille>.agent.md`, outils `read, search, edit`, `user-invocable: false`), dossiers de revue, verdict écrit dans `verdict.json`. Différences :

- au retour d'un subagent, `PostToolUse` ne peut pas bloquer sous Copilot : la consigne passe par `additionalContext`, et par la réponse modifiée du subagent (`modifiedResponse`) ; c'est le `Stop` du thread principal qui l'impose ;
- le garde-fou de Copilot coupe après 8 blocages consécutifs : `max_iterations` reste strictement inférieur à 8 ;
- l'agent intégré `general-purpose` n'émet pas d'événements de subagent, mais les reviewers sont des agents du plugin et ne sont pas concernés.

## Signal d'escalade

À l'escalade, le hook `SubagentStop` laisse le subagent se terminer et renvoie `modifiedResponse` : la réponse remise au parent est complétée par `[agent-controls] ESCALADE`, le chemin du rapport de run et les points en suspens. Un orchestrateur Copilot sait donc, dès le retour du subagent, que le travail n'est pas validé. Claude Code n'offre pas d'équivalent : le signal passe par le `Stop` du thread principal et le rapport de run.

## Hooks liés à l'agent (alternative)

Copilot CLI accepte des hooks déclarés dans le frontmatter d'un agent, actifs seulement quand cet agent est utilisé. C'est séduisant, mais ils ne sont pas supportés par Claude Code de la même façon, et leurs chemins se résolvent depuis la racine du dépôt, pas du plugin. Le générateur ne les utilise donc pas.

## Commandes de test (phase 7)

```bash
copilot plugin install ./<agent>.controls/dist/<agent>
copilot plugin list
```

Puis, dans une session : vérifier que l'agent est proposé, déclencher une action interdite et vérifier le refus. Désinstaller avec `copilot plugin uninstall <agent>`.
