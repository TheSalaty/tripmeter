# Tripmeter

Claude Code and Codex limits in the GNOME top bar, with a marker that tells you whether you are
burning through the week or leaving quota on the table.

<p align="center">
  <img src="docs/panel.png" alt="Tripmeter in the top bar: one icon and percentage per account" width="300">
</p>

<p align="center">
  <img src="docs/menu.png" alt="Tripmeter menu with one card per account" width="420">
</p>

## What it shows

**Every limit, per account.** Claude's 5-hour session, the weekly limit and the per-model weekly
limits; whatever windows Codex's plan has. One card per account, in the colour you gave it, and
one icon and percentage per account in the top bar.

**Pace.** The white tick on each bar is where an even spread would be right now. Left of it, you
have room to use more. Right of it, the line under the bar turns amber and tells you when the limit
runs out at the current rate, e.g. `13% over pace · runs out at 21:18`.

**Where the week lands.** Weekly bars carry a paler segment and an `est. 112% at reset`: the figure at reset if
your pace holds. It is weighted by your own weekday rhythm, so a quiet weekend ahead counts for
less than a Tuesday. 85–95% at reset is the sweet spot.

**Left or used.** Limits count down by default, like the usage pages of Claude and Codex: `74%`
is what you have left, the bar drains, room to use more is a bar ending right of the tick, and
the stretch of a weekly bar left of the gap is what the estimate leaves unused at reset.
Switch *Show limits as* to *Percent used* in the settings to count up instead; the figures above
are in that mode.

**What it would have cost.** Click the cost line on a card to see your tokens priced at API list
rates for the last 24 hours, 7 days or 30 days: by model, skill, subagent and MCP tool, plus what
prompt caching saved.

<p align="center">
  <img src="docs/details.png" alt="A card with its cost details folded out" width="380">
</p>

**Several Claude accounts.** Work and personal logins live in separate config directories
(`CLAUDE_CONFIG_DIR`). Tripmeter reads each one as its own account. You can switch Codex off without
uninstalling it.

Nothing leaves your machine. Tripmeter reads the session files the CLIs already write. Its only
network request is the usage call Claude Code itself makes, sent with the token Claude Code already
stored. You don't need an API key or a helper CLI, and there is no telemetry.

GNOME Shell 49 and 50. Works with either CLI on its own or with both.

## Install

Download the zip from the [latest release](https://github.com/TheSalaty/tripmeter/releases/latest)
and install it:

```sh
gnome-extensions install --force ~/Downloads/tripmeter@thesalaty.github.io.shell-extension.zip
```

Log out and back in (GNOME on Wayland only loads new extensions at login), then:

```sh
gnome-extensions enable tripmeter@thesalaty.github.io
```

### From source

Needs Node.js 20 or newer.

```sh
git clone https://github.com/TheSalaty/tripmeter.git
cd tripmeter
npm install
make install
```

`make pack` builds the installable zip.

## Accounts

Open the settings from the gear in the menu, or with
`gnome-extensions prefs tripmeter@thesalaty.github.io`.

<p align="center">
  <img src="docs/settings.png" alt="The Providers tab: one row per account with a colour, a name and a switch" width="520">
</p>

The **Providers** tab has one row per Claude Code config directory or Codex home. Each row has a
name, a colour and an on/off switch. If you use T3 Code, **Import from T3 Code**
copies the names, accent colours and directories of the providers you set up there.

The same list is a JSON setting, so you can script it:

```sh
dconf write /org/gnome/shell/extensions/tripmeter/providers "'[
  {\"kind\": \"claude\", \"name\": \"Work\", \"color\": \"#3584e4\"},
  {\"kind\": \"claude\", \"name\": \"Personal\", \"color\": \"#2ec27e\", \"home\": \"~/.claude-personal\"},
  {\"kind\": \"codex\", \"enabled\": false}
]'"
```

An empty `home` means the CLI's default directory. `dconf reset` on the key goes back to every
installed CLI.

The **General** tab sets what the top bar shows (limits, cost or just the icon), the cost window
and the refresh interval.

## Prices

The price list is in [`src/lib/pricing.ts`](src/lib/pricing.ts). To override it, create
`~/.config/tripmeter/pricing.json` with prices in USD per million tokens:

```json
{
  "gpt-5.6": { "input": 5, "output": 30 },
  "claude-opus": { "input": 5, "output": 25, "cacheReadFactor": 0.1 }
}
```

The longest matching model prefix wins.

## Fine print

- The cost is what the same tokens would cost on the API. A subscription is flat-rate, so it is not
  a bill.
- Claude's OAuth token is only read, never refreshed. Refreshing it here would log Claude Code out.
  If it has expired, start Claude Code once.
- api.anthropic.com rate-limits the usage endpoint hard. Tripmeter caches each account's limits for
  a few minutes and keeps the last good reading if a request is refused.
- Codex limits come from its most recent session file and only change when Codex runs.
- The weekly forecast looks back at most 16 days. Codex's comes from the limit history in its
  session files. Claude publishes no history, so Tripmeter records a daily figure as it runs, and
  the forecast gets better over the first two weeks. It is a projection, not a promise.

Development notes are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## License

[MIT](LICENSE). Not affiliated with Anthropic or OpenAI.
