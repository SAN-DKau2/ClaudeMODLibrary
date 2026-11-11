# ClaudeMODLibrary

A personal library (marketplace) of Claude Code mods.

## Mods

| Mod | What it does |
| --- | --- |
| [token-usage](plugins/token-usage) | Opens a **Token usage** pane: current-session and weekly plan limits as bars with reset times, input/output/cache token totals, context fill and session cost. `/tokens` reopens the pane. Under the prompt it pins a compact status entry: Session % · Week % (how long ago they were reported, refreshed every 2 minutes) · tokens in · out. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin marketplace add SAN-DKau2/ClaudeMODLibrary
/plugin install token-usage@ClaudeMODLibrary
```

From a shell:

```
claude plugin marketplace add SAN-DKau2/ClaudeMODLibrary
claude plugin install token-usage@ClaudeMODLibrary
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `SAN-DKau2/ClaudeMODLibrary`, then **Add plugin**.

A mod installed from a terminal at user scope also loads in the desktop app's Code tab.

If this repository is private, installing works only on a machine that already has a git credential for github.com (an SSH key, or `gh auth login` then `gh auth setup-git`); the install never prompts for one.

## Adding a mod

Put it in `plugins/<mod-name>/` and add an entry to `.claude-plugin/marketplace.json`.
