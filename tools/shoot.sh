#!/bin/bash
set -u
UUID=tripmeter@thesalaty.github.io
HERE=$(cd "$(dirname "$0")" && pwd)
SANDBOX=${AIU_SANDBOX:-/tmp/aiu-home}

# A private bus, or the headless shell loses org.gnome.Shell to the running
# session and every D-Bus call below drives the real desktop instead.
if [ -z "${AIU_PRIVATE_BUS:-}" ]; then
  AIU_PRIVATE_BUS=1 exec dbus-run-session -- "$0" "$@"
fi

rm -rf "$SANDBOX"
mkdir -p "$SANDBOX/config" "$SANDBOX/data/gnome-shell/extensions" "$SANDBOX/cache" "$SANDBOX/state"
cp -r "$HOME/.local/share/gnome-shell/extensions/$UUID" "$SANDBOX/data/gnome-shell/extensions/" || {
  echo "run 'make install' first"
  exit 1
}
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CACHE_HOME="$SANDBOX/cache"
export XDG_STATE_HOME="$SANDBOX/state"

# dconf writes reach the real session bus even here, so settings go to a throwaway keyfile instead.
export GSETTINGS_BACKEND=keyfile

gsettings set org.gnome.shell welcome-dialog-last-shown-version '99.0' 2>/dev/null || true

gnome-shell --headless --virtual-monitor "${AIU_MONITOR:-1400x1000}" >/tmp/aiu-shell.log 2>&1 &
SHELL_PID=$!
trap 'kill $SHELL_PID 2>/dev/null; wait $SHELL_PID 2>/dev/null' EXIT
sleep 12

if ! kill -0 $SHELL_PID 2>/dev/null || grep -q "already exists on bus" /tmp/aiu-shell.log; then
  echo "headless shell did not come up — see /tmp/aiu-shell.log"
  exit 1
fi

gnome-extensions enable "$UUID" || echo "could not enable $UUID"
sleep 12

gjs -m "$HERE/screenshot.js" "$@"

echo "--- shell log (extension-relevant lines) ---"
grep -iE "JS ERROR|St-WARNING|$UUID" /tmp/aiu-shell.log | head -15
