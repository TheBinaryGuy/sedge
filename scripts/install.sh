#!/bin/sh
# Installs sedge: curl -fsSL sedge.sh | sh
#
# Downloads this machine's binary from the latest GitHub release into ~/.sedge/bin (or
# $SEDGE_HOME/bin). `sedge update` and the daemon's auto-update replace it there. Set
# SEDGE_VERSION=0.0.1 to install a particular version.
set -eu

repo="sedge-hq/sedge"

case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) echo "sedge: no build for $(uname -s) yet; on Windows use: npm i -g @sedge-hq/sedge" >&2; exit 1 ;;
esac
case "$(uname -m)" in
    arm64 | aarch64) cpu=arm64 ;;
    x86_64 | amd64) cpu=x64 ;;
    *) echo "sedge: no build for $(uname -m) yet" >&2; exit 1 ;;
esac

asset="sedge-$os-$cpu.tar.gz"
if [ -n "${SEDGE_VERSION:-}" ]; then
    url="https://github.com/$repo/releases/download/v$SEDGE_VERSION/$asset"
else
    url="https://github.com/$repo/releases/latest/download/$asset"
fi

home="${SEDGE_HOME:-$HOME/.sedge}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${asset}..."
curl -fsSL "$url" -o "$tmp/$asset"
tar -xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$home/bin"
cp -R "$tmp/bin/." "$home/bin/"
chmod +x "$home/bin/sedge"

echo "Installed $("$home/bin/sedge" --version) to $home/bin/sedge"
case ":$PATH:" in
    *":$home/bin:"*) echo "Run: sedge" ;;
    *)
        case "${SHELL:-}" in
            */zsh) rc="$HOME/.zshrc" ;;
            */bash) rc="$HOME/.bashrc" ;;
            *) rc="your shell's startup file" ;;
        esac
        echo "Add it to your PATH (in $rc):"
        echo "  export PATH=\"$home/bin:\$PATH\""
        ;;
esac
