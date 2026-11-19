// Every page: render Mermaid diagrams as step-through players. Mermaid comes from the
// bundle, so the player never loads it from a CDN.
import mermaid from 'mermaid';
import { autoInit } from 'mermaid-flow-player/auto-init';

// Colours come from the shadcn tokens in global.css, so one theme serves light and dark mode.
mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
window.mermaid = mermaid;
autoInit({ narration: false });
