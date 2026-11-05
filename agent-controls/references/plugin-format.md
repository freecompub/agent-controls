# Format du plugin généré

À lire en phases 5 et 7. Le plugin doit se charger dans Claude Code et dans Copilot à partir **d'un seul dossier**. Les deux clients ont des formats proches mais pas identiques ; ce document fixe la structure que produit le générateur et explique pourquoi.

## Structure

```
<agent>/
├── .claude-plugin/
│   └── plugin.json            # manifeste lu par Claude Code
├── plugin.json                # manifeste lu par Copilot (prioritaire pour lui)
├── agents/
│   └── <agent>.md             # agent, format Claude Code
├── copilot/
│   ├── agents/
│   │   └── <agent>.agent.md   # agent, format Copilot
│   └── hooks.json             # hooks, format Copilot
│   (agents/ et copilot/agents/ contiennent aussi un reviewer par lentille : <agent>-review-<lentille>)
├── hooks/
│   └── hooks.json             # hooks, format Claude Code
├── runtime/                   # dispatcher, logs, état du run, rapport
├── checks/                    # modules custom
├── controls.json              # contrat compilé
└── README.md
```

## Pourquoi deux manifestes

- **Claude Code** lit `.claude-plugin/plugin.json` et prend par défaut `agents/` et `hooks/hooks.json`.
- **Copilot CLI** cherche le manifeste dans cet ordre : `.plugin/plugin.json`, `plugin.json`, `.github/plugin/plugin.json`, `.claude-plugin/plugin.json`. Le `plugin.json` racine est donc trouvé en premier, et ses champs de chemins pointent vers `copilot/`.

Les fichiers Copilot sont isolés dans `copilot/` pour que Claude Code ne charge pas les `.agent.md` comme des agents supplémentaires.

Les reviewers sont des agents du plugin, un par lentille (`<agent>-review-<lentille>`), exécutés par le client. Ils ne se lancent qu'avec un dossier de revue en attente : le hook refuse tout autre appel, et ils ne peuvent écrire que leur verdict. Côté Copilot, ils portent `user-invocable: false` ; côté Claude Code, leur description indique qu'ils sont internes.

## Manifestes

`.claude-plugin/plugin.json` :

```json
{
  "name": "migration-writer",
  "version": "0.1.0",
  "description": "Agent migration-writer avec ses contrôles (hooks + reviewer)"
}
```

`plugin.json` (Copilot, format historique, **sans** `$schema`) :

```json
{
  "name": "migration-writer",
  "version": "0.1.0",
  "description": "Agent migration-writer avec ses contrôles (hooks + reviewer)",
  "agents": "copilot/agents/",
  "hooks": "copilot/hooks.json"
}
```

Le format Agent Plugins 1.0 (`$schema` déclaré) n'est pas utilisé : il ne définit ni agents ni hooks portables, et impose d'autres emplacements. Le générateur reste sur le format historique tant que c'est le cas.

Contraintes sur le nom : minuscules, chiffres et tirets, 64 caractères au plus, identique dans les deux manifestes et égal à `plugin.name` du contrat (par défaut, le nom de l'agent).

## Conversion de l'agent

Le fichier fourni par l'utilisateur est dans **un** des deux formats. Le générateur produit l'autre :

| Élément | Claude Code (`agents/*.md`) | Copilot (`*.agent.md`) |
|---|---|---|
| Identifiant | champ `name` | nom du fichier sans `.agent.md` |
| Outils | noms Claude (`Read`, `Edit`, `Bash`…) | alias Copilot : `read`, `edit`, `search`, `execute`, `web`, `agent`, `todo`, `serveur/outil` |
| Modèle | champ `model` | champ propre à Copilot |
| Corps | prompt Markdown | prompt Markdown, inchangé |

Copilot ignore silencieusement les noms d'outils qu'il ne reconnaît pas : un outil mal traduit priverait l'agent de cet outil sans prévenir. Le générateur s'arrête donc sur tout outil sans correspondance connue plutôt que de deviner. Le modèle n'est pas reporté d'un format à l'autre (identifiants différents) ; le générateur l'indique par un avertissement.

Les autres champs du frontmatter (`user-invocable`, `metadata`…) sont reportés tels quels dans l'autre format, avec un avertissement : un client ignore ce qu'il ne connaît pas, alors qu'un champ supprimé changerait le comportement sans prévenir.

Le corps du prompt n'est jamais modifié. Si l'agent source contient des instructions propres à un client (noms d'outils dans le texte), le générateur le signale sans corriger.

## Conflits de noms

- **Copilot** : un agent du projet (`.github/agents/`, `.claude/agents/`) ou de l'utilisateur portant le même identifiant **masque** l'agent du plugin, sans avertissement. Les hooks du plugin, eux, s'appliquent quand même, puisqu'ils filtrent sur le type d'agent : les contrôles portent alors sur la définition du projet, pas sur celle du plugin. À signaler en phase 8 si le fichier source se trouve dans un de ces dossiers.
- **Claude Code** : **À vérifier**, la règle de priorité entre un agent de projet et un agent de plugin portant le même nom.

## Marketplace

Pour installer depuis un dépôt plutôt que depuis un chemin local, `package.mjs --marketplace <dossier>` crée ou met à jour `<dossier>/.claude-plugin/marketplace.json`, en remplaçant l'entrée du plugin si elle existe. Le plugin doit se trouver sous ce dossier. Copilot CLI lit aussi ce fichier.

```json
{
  "name": "mes-agents",
  "owner": { "name": "Samir" },
  "plugins": [
    { "name": "migration-writer", "version": "0.1.0",
      "source": "./migration-writer.controls/dist/migration-writer" }
  ]
}
```

## Installation et test (phase 7)

| Client | Ajouter la marketplace | Installer |
|---|---|---|
| Claude Code | `/plugin marketplace add <chemin-ou-dépôt>` | `/plugin install <agent>@<marketplace>` |
| Copilot CLI | `copilot plugin marketplace add <chemin-ou-dépôt>` | `copilot plugin install <agent>@<marketplace>` ou `copilot plugin install <chemin-du-plugin>` |

Checklist de chargement, sur chaque client ciblé :

1. Le plugin apparaît dans la liste des plugins installés, avec la bonne version.
2. L'agent et ses reviewers apparaissent dans la liste des agents du client.
3. Une action interdite par un contrôle `PreToolUse` est refusée, avec le message attendu.
4. Le fichier `.agent-controls/.runs/<run>/events.jsonl` apparaît dans le projet.
5. Le dispatcher localise bien son runtime (variable de racine du plugin développée).

Un échec sur un seul point rend le plugin non livrable pour ce client.

## Données à l'exécution

Le dossier d'installation d'un plugin est un cache, remplaçable à chaque mise à jour : le runtime n'y écrit jamais. L'état du run et les logs vont dans le projet (`.agent-controls/.runs/`). Copilot expose aussi un dossier de données persistant par plugin (`${COPILOT_PLUGIN_DATA}`) ; il n'est pas utilisé, car les mesures doivent rester rattachées au projet mesuré.
