# Development

```sh
npm run build          # tsc
npm test               # tsc + node --test over src/lib
make install           # install into ~/.local/share/gnome-shell/extensions
make logs              # follow gnome-shell's journal
gjs -m build/src/collector/main.js --window 7 | jq   # run the collector by hand
```

```
src/lib/         pure aggregation and formatting — no GI imports, covered by tests
src/collector/   the out-of-process collector (files, grep, HTTP)
src/ui/          panel button, menu rows
tools/           headless screenshot harness (see below)
```

## Where the numbers come from

| | Limits | Cost |
|---|---|---|
| **Claude Code** | `GET /api/oauth/usage` with the OAuth token in `~/.claude/.credentials.json` | `~/.claude/projects/**/*.jsonl` |
| **Codex** | the rate-limit snapshot in the newest `~/.codex/sessions/**/rollout-*.jsonl` | the same rollout files |

The only outbound request is the one Claude Code itself makes to read your limits, with the token
Claude Code already stored. Refreshing that token here would rotate the refresh token out from
under Claude Code and log you out, so it is read as-is.

## How it works

The shell process only draws. All the reading and parsing happens in a separate short-lived
process (`collector/main.js`, run with `gjs -m`) that prints one JSON snapshot on stdout, because
aggregating a 30-day window means touching hundreds of megabytes of transcript and doing that
in-process would stall the compositor.

Inside the collector, `find -newermt` narrows to files touched within the window — transcripts are
append-only, so a file older than the window cannot hold records inside it — and `grep` pulls out
the few thousand lines that carry token usage before any JSON parsing happens. A 30-day collection
over 1.4 GB of transcript takes under two seconds.

Two details the parsers exist to get right:

- Claude Code writes one record per content block while streaming, and a resumed or forked session
  re-logs earlier assistant messages verbatim. Both mean the same `message.id` appears several
  times, so records are deduplicated by id and the largest usage figure wins.
- Codex reports token usage as a **running total per session** and repeats the same snapshot across
  events. Spend is therefore the rise in that total, not the sum of the per-request field.

The weekly forecast divides the current usage by the share of the window that has already elapsed —
but that share is weighted by a weekday profile, so a window with an idle weekend still ahead of it
projects lower than a flat extrapolation. Codex builds the profile from the rise in the percentage
its own rollouts record per day, which is what the limit actually measures; Claude has no such
history, so the collector records what its transcripts cost per day as it runs. Both keep 16 days —
two of every weekday — and both are shrunk towards a flat week and clamped, because a fortnight of
history is a rhythm, not a law.

Skills and subagents are independent characteristics of the same spend, not a partition: their
shares overlap and do not sum to 100%. Claude Code stamps every assistant record with the skill,
subagent and MCP tool it ran under, so these are read from the transcript rather than guessed.

A model with no price contributes tokens but no cost, and the menu names it in a warning rather
than quietly pricing it at zero.

## Looking at the UI without touching your session

`tools/shoot.sh` re-executes itself on a private D-Bus session and starts a headless GNOME Shell
on a virtual monitor with a throwaway XDG home — so no other extension loads and the real
desktop's dconf and session bus are untouched — enables this extension, drives the pointer through
Mutter's RemoteDesktop interface and captures frames from its ScreenCast PipeWire stream:

```sh
make install
./tools/shoot.sh --click 1095,12:menu --click 1030,308:expanded
# frames land in /tmp/aiu-shots/
# docs/menu.png is the menu frame cropped to 560x690+840+0
```

GNOME 49+ refuses `org.gnome.Shell.Screenshot` for headless sessions and no longer exposes an
`UnsafeMode` property for `Eval`, which is why the harness goes through RemoteDesktop and
ScreenCast rather than asking the shell for a screenshot.
