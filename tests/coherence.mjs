// Reuse the existing frozen-pose screenshot and performance harness.
process.env.VOID_VISUAL_SUITE = 'coherence';
await import('./rendering.mjs');
