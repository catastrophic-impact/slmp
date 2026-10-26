#!/usr/bin/env bash
# SLMP - Simple Local Music Player
# Copyright (C) 2026 catastrophic-impact
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Run a command (default: `npm start`) inside slmp-box with the host filesystem
# READ-ONLY. Only the box home ($HOME) and runtime/IPC dirs stay writable, so
# the app can read music from anywhere but can't write into the real host home.
#
#   ./run.sh                 # npm start
#   ./run.sh npm run build:linux
#   SLMP_BOX=other-box ./run.sh   # use a differently named distrobox
#
# The project must live inside the box's home directory, since that is the
# only writable place in the sandbox (see optional-build.sh to set one up).
set -euo pipefail

if [ -z "${CONTAINER_ID:-}" ]; then
  exec distrobox enter "${SLMP_BOX:-slmp-box}" -- "$(realpath "$0")" "$@"
fi

cd "$(dirname "$(realpath "$0")")"
[ $# -eq 0 ] && set -- npm start

exec bwrap \
  --ro-bind / / \
  --dev-bind /dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --ro-bind-try /tmp/.X11-unix /tmp/.X11-unix \
  --bind "$HOME" "$HOME" \
  --bind "$XDG_RUNTIME_DIR" "$XDG_RUNTIME_DIR" \
  --die-with-parent \
  -- "$@"
