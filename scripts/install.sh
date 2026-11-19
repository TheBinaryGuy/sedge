#!/bin/sh
# Installs sedge without npm: curl -fsSL https://raw.githubusercontent.com/sedge-hq/sedge/main/scripts/install.sh | sh
# The binary goes to ~/.sedge/bin, which `sedge update` (and the daemon's auto-update) replace in place.
set -eu

case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) echo "sedge: unsupported OS $(uname -s); try npm i -g sedge" >&2; exit 1 ;;
esac
case "$(uname -m)" in
    arm64 | aarch64) cpu=arm64 ;;
    x86_64 | amd64) cpu=x64 ;;
    *) echo "sedge: unsupported CPU $(uname -m)" >&2; exit 1 ;;
esac

pkg="@sedge-hq/sedge-$os-$cpu"
home="${SEDGE_HOME:-$HOME/.sedge}"
tarball=$(curl -fsSL "https://registry.npmjs.org/@sedge-hq%2fsedge-$os-$cpu/latest" | sed -n 's/.*"tarball":"\([^"]*\)".*/\1/p')
[ -n "$tarball" ] || { echo "sedge: could not find $pkg on npm" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$tarball" | tar -xz -C "$tmp"
mkdir -p "$home/bin"
cp -R "$tmp/package/bin/." "$home/bin/"
chmod +x "$home/bin/sedge"

echo "Installed sedge to $home/bin/sedge"
case ":$PATH:" in
    *":$home/bin:"*) ;;
    *) echo "Add it to your PATH: export PATH=\"$home/bin:\$PATH\"" ;;
esac
