# Critères de qualité des livrables

À lire en phases 2 et 3. Les modes de défaillance disent ce qui peut mal tourner dans le *comportement* de l'agent. Les critères de qualité disent à quoi on reconnaît un *bon* livrable. Les deux alimentent les contrôles ; la qualité relève surtout du reviewer, parce qu'elle demande souvent un jugement.

Un défaut de qualité est un mode de défaillance comme un autre (« un scénario n'est rattaché à aucun AC ») : il a un identifiant `FM-NN` et chaque critère le couvre via `covers`.

## Sources

1. **La définition de l'agent** : formats imposés, règles « toujours » et « jamais », auto-vérifications qu'elle demande. Une auto-vérification écrite dans le prompt est un critère tout trouvé : le reviewer vérifie ce que l'agent est censé avoir vérifié.
2. **Le catalogue générique** ci-dessous, pour les dimensions que la définition ne couvre pas.
3. **Seulement si l'utilisateur les fournit** — après les lui avoir nommées (`inspect_agent.mjs` liste les skills chargés) : le contenu des skills que l'agent charge, ou les critères d'un reviewer existant. Ne va jamais les chercher toi-même (dépôt, web) : sans son accord, tu jugerais l'agent avec une grille qu'il n'a pas choisie, et tu ne mesurerais plus ce que la méthode produit. Si une source manque et compte, demande-la.

Les règles du métier (architecture, méthode de test, conventions d'un domaine) vivent souvent dans ces skills, pas dans le prompt. Sans eux, la méthode produit des critères fidèles au prompt mais aveugles à ces règles. Si l'utilisateur ne les fournit pas, déclare-les dans `uncovered_sources` avec ce qui n'est pas contrôlé : le README du plugin et la restitution le diront.

## Catalogue générique

Pour chaque livrable, passe chaque dimension et demande : « que vérifierait un relecteur humain exigeant ? »

| Dimension | Question type | Exemple |
|---|---|---|
| Complétude | Chaque élément de la source est-il traité ? | chaque AC a un scénario |
| Fidélité | Chaque valeur ou affirmation est-elle traçable à la source, sans ajout ? | aucune valeur inventée ou arrondie |
| Adéquation au destinataire | Le livrable est-il compréhensible par celui qui doit le lire ? | Gherkin en langage métier |
| Exploitabilité | L'étape suivante peut-elle l'utiliser sans rien décider ? | plan sans cellule « à définir » |
| Conformité | Respecte-t-il les frontières et conventions du projet ? | le test entre par le use case des contrats |
| Robustesse | Les cas limites et négatifs sont-ils représentés ? | au moins un cas d'erreur par règle |
| Cohérence | Les livrables se contredisent-ils entre eux ? | plan de tests et plan d'implémentation alignés |

Toutes les dimensions ne s'appliquent pas à tous les livrables ; ne garde que celles qui ont un sens.

## Écrire un critère

- **Question fermée**, une seule vérification par question. « Est-il de bonne qualité ? » et « A-t-il X et Y ? » sont à éviter.
- **Vérifiable avec les entrées de sa lentille** : un critère qui exige un fichier que sa lentille ne reçoit pas sera mal jugé.
- **Mécanisable d'abord** : si le critère peut être un hook, c'est un hook ; le reviewer peut le doubler en défense en profondeur.
- **Sans format supposé** : si le juger exige de connaître un format non fourni, garde le critère au reviewer et trace le hook envisagé dans `deferred`.

## Sévérité

| Sévérité | Sens | Par défaut |
|---|---|---|
| `blocker` | livrable faux par rapport à sa source, ou inutilisable | bloque |
| `high` | l'étape suivante échouera ou devra être refaite | bloque |
| `medium` | qualité dégradée sans échec prévisible | bloque |
| `low` | finition | consigné comme observation |

`reviewer.block_on` fixe les sévérités bloquantes. Les observations non bloquantes sont écrites dans le run (`observations-N.md`) et comptées par `report.mjs`.

## Lentilles

Une lentille regroupe des critères qui ont besoin des mêmes entrées. Chaque lentille est **un agent reviewer distinct**, lancé par le client avec son propre dossier de revue, qui ne contient que :

- les entrées du run qu'elle déclare (`task`, `diff`, `artifacts`) ;
- les fichiers de référence de son `context` (globs résolus dans le projet).

L'isolation est réelle : une lentille « langage métier » qui ne voit pas le code ne peut pas excuser un jargon technique par sa connaissance de l'implémentation. Trois à cinq lentilles suffisent en général ; chacune coûte un appel, mais elles tournent en parallèle.

```yaml
reviewer:
  block_on: [blocker, high, medium]
  lenses:
    - { name: coverage, inputs: [artifacts], context: ["**/ac-draft-*.md", "**/features/*.feature"] }
    - { name: business-language, inputs: [], context: ["**/features/*.feature", "**/stories-*.md"] }
  criteria:
    - { id: C1, lens: coverage, severity: blocker, covers: [FM-12], question: "…" }
```

## Indéterminé, accès et connaissances

- **Indéterminé** : « non » veut dire « le livrable a un défaut » ; quand les éléments manquent pour juger, le reviewer répond `inconclusive`. Ne force pas un « non » par prudence : il renverrait l'agent corriger un défaut qui n'existe peut-être pas.
- **Accès** : une lentille `listed` ne lit que ce qu'on lui donne ; une lentille `project` peut chercher dans le projet. Réserve `project` aux critères qui exigent une recherche (« un test existe-t-il pour chaque use case nouveau ? ») : plus l'accès est large, plus la lentille peut se laisser influencer.
- **Connaissances** : si un critère s'appuie sur une définition (« walking skeleton », règle d'un skill), donne cette définition au reviewer via `reviewer.knowledge` plutôt que de compter sur ce qu'il croit savoir.

## Calibrer

Les fixtures avec verdict simulé testent la *mécanique*. Pour la *justesse* du jugement, écris des fixtures `live` : un livrable connu comme bon et, pour les critères `blocker`, des livrables connus comme mauvais (à partir des exemples de `samples/`). Fais-les juger par le client avec `live_review.mjs prepare`, puis `collect`. En usage, les faux positifs annotés dans `report.mjs` disent quels critères reformuler.
