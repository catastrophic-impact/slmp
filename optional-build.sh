#!/usr/bin/env bash
# SLMP - Simple Local Music Player
# Copyright (C) 2026 catastrophic-impact
# SPDX-License-Identifier: GPL-3.0-or-later
#
# OPTIONAL: reproduce the SLMP development/build environment from scratch.
#
# Creates a distrobox (Ubuntu 22.04) with its own separate home directory,
# installs Node.js 22 plus the libraries Electron needs, puts the project
# inside that home, installs npm dependencies, and builds the AppImage via
# run.sh (a bubblewrap sandbox that keeps the real host home read-only).
#
# Requirements on the host: distrobox + podman (or docker). Both ship with
# SteamOS 3.5+; other distros: https://distrobox.it
#
#   ./optional-build.sh
#
# Override defaults with environment variables:
#   SLMP_BOX=slmp-box                        distrobox name
#   SLMP_BOX_HOME=$HOME/boxes/slmp-box-home  the box's home directory
#   SLMP_APP_DIR=$SLMP_BOX_HOME/slmp         where the project lives in that home
set -euo pipefail

BOX="${SLMP_BOX:-slmp-box}"
BOX_HOME="${SLMP_BOX_HOME:-$HOME/boxes/slmp-box-home}"
APP_DIR="${SLMP_APP_DIR:-$BOX_HOME/slmp}"
IMAGE="docker.io/library/ubuntu:22.04"
REPO_DIR="$(cd "$(dirname "$(realpath "$0")")" && pwd)"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ -n "${CONTAINER_ID:-}" ]; then
  echo "Run this on the host, not inside a distrobox." >&2
  exit 1
fi
command -v distrobox >/dev/null || { echo "distrobox is not installed (https://distrobox.it)" >&2; exit 1; }

# 1. The box, with its own home so builds never touch your real home
mkdir -p "$BOX_HOME"
if distrobox list | awk -F'|' 'NR > 1 { gsub(/ /, "", $2); print $2 }' | grep -qx "$BOX"; then
  say "Using existing distrobox '$BOX'"
else
  say "Creating distrobox '$BOX' ($IMAGE) with home $BOX_HOME"
  distrobox create --name "$BOX" --image "$IMAGE" --home "$BOX_HOME" --yes
fi

# 2. System packages: Node 22 (NodeSource), Electron runtime libraries,
#    PulseAudio client, bubblewrap (run.sh sandbox), xvfb (headless runs),
#    libfuse2 (to run AppImages)
say "Installing build dependencies inside '$BOX'"
distrobox enter "$BOX" -- bash -euo pipefail -c '
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates curl gnupg git \
    bubblewrap xvfb libpulse0 libfuse2 \
    libnss3 libgtk-3-0 libgbm1 libasound2 libatk-bridge2.0-0 libxss1 libdrm2 libxkbcommon0
  if ! node --version 2>/dev/null | grep -q "^v22\."; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  fi
  echo "node $(node --version), npm $(npm --version)"
'

# 3. The project must be inside the box home (the only writable place for run.sh)
case "$REPO_DIR/" in
  "$BOX_HOME"/*)
    APP_DIR="$REPO_DIR"
    say "Project is already inside the box home: $APP_DIR"
    ;;
  *)
    say "Copying project into $APP_DIR"
    mkdir -p "$APP_DIR"
    tar -C "$REPO_DIR" --exclude=./node_modules --exclude=./dist --exclude=./.git -cf - . | tar -C "$APP_DIR" -xf -
    ;;
esac

# 4. npm dependencies (exact versions from package-lock.json) and the build
cd "$APP_DIR"
say "Installing npm dependencies"
SLMP_BOX="$BOX" ./run.sh npm ci
say "Building the AppImage"
SLMP_BOX="$BOX" ./run.sh npm run build:linux

say "Done: $(ls "$APP_DIR"/dist/*.AppImage)"
echo "Run from source with:  cd \"$APP_DIR\" && SLMP_BOX=$BOX ./run.sh"
