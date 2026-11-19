// pi's Bun build embeds its image worker at ./src/utils/image-resize-worker.ts and loads it from
// there; this shim sits at that path in our compile root (`--root apps/cli`). Build-only.
import '../../node_modules/@earendil-works/pi-coding-agent/dist/utils/image-resize-worker.js';
