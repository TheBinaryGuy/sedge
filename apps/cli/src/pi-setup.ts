/*
 * What pi's own Bun entry (`dist/bun/cli.js`) does before its CLI starts: restore a sandboxed
 * environment, embed the QuickJS wasm codemode runs on, register Bun's OAuth flows for /login.
 * Neither module is in pi's package exports, so they're imported by path. Must run first.
 */
import '../node_modules/@earendil-works/pi-coding-agent/dist/bun/sandbox-env-setup.js';
import '../node_modules/@earendil-works/pi-coding-agent/dist/bun/runtime-setup.js';
