// pi's Bun build embeds the codemode worker at ./src/extensions/codemode/worker.ts; this shim sits
// at that path in our compile root (`--root apps/cli`). Build-only.
import '../../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/worker.js';
