# Tripmeter Usage

A GNOME Shell extension for checking Claude Code and Codex usage from the top panel.

It shows your current limits and resets, plus an estimate of what your token usage would cost at
API list prices. Data comes from local session files and stays on your machine.

<p align="center">
  <img src="docs/menu.png" alt="Tripmeter menu" width="420">
</p>

## Features

- Claude Code and Codex limits and reset times
- Weekly forecast: where the limit lands at reset, weighted by which weekdays you actually work
- API-equivalent cost for the past 24 hours, 7 days or 30 days
- Cost by model, skill, subagent and MCP tool
- Prompt-cache savings
- Panel display with limit, cost or icon only

Tripmeter works with either CLI on its own or with both. It supports GNOME Shell 49 and 50.

## Install

Download the zip from the [latest release](https://github.com/TheSalaty/tripmeter/releases/latest),
then run:

```sh
cd ~/Downloads
```

Then run:

```sh
gnome-extensions install --force tripmeter@thesalaty.github.io.shell-extension.zip
```

Log out and back in, then enable the extension:

```sh
gnome-extensions enable tripmeter@thesalaty.github.io
```

### From source

Requires Node.js 20 or newer.

```sh
git clone https://github.com/TheSalaty/tripmeter.git
cd tripmeter
npm install
make install
```

Log out and back in before enabling the extension. Run `make pack` to build an installable zip.

## Settings

Open the settings from the gear in the menu or run:

```sh
gnome-extensions prefs tripmeter@thesalaty.github.io
```

You can change the panel display, visible providers, cost window and refresh interval.

Model prices are defined in [`src/lib/pricing.ts`](src/lib/pricing.ts). To override them, create
`~/.config/tripmeter/pricing.json`:

```json
{
  "gpt-5.6": { "input": 5, "output": 30 },
  "claude-opus": { "input": 5, "output": 25, "cacheReadFactor": 0.1 }
}
```

Prices are in USD per million tokens. The longest matching model prefix wins.

## Notes

- API-equivalent cost is an estimate, not a subscription bill.
- Claude's OAuth token is only read, never refreshed. Starting Claude Code refreshes an expired token.
- Codex limits come from its latest local session snapshot and update when Codex runs.
- The weekly forecast extrapolates the pace so far and weights the days left in the window by how
  much each weekday usually takes — an idle weekend ahead counts for less than a Tuesday. Codex
  reads that rhythm from the limit history in its own session files; for Claude, Tripmeter records
  one figure per day as it runs, so the estimate keeps sharpening over the first couple of weeks of
  use. Neither looks further back than 16 days, so a rhythm you have left behind stops counting.
  It is a projection, not a promise — landing at 85–95% uses the week without overrunning it.

For development notes, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## License

[MIT](LICENSE). Tripmeter is not affiliated with Anthropic or OpenAI.
