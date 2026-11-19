// Turn ```mermaid fences into <pre class="mermaid not-content"> before Expressive Code sees them,
// so mermaid-flow-player's autoInit finds the diagram source and renders it as a player.
// `not-content` keeps Starlight's prose spacing (a top margin on each sibling) off the player's controls.
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function remarkMermaid() {
  return (tree) => {
    function visit(node) {
      for (const [i, child] of (node.children ?? []).entries()) {
        if (child.type === 'code' && child.lang === 'mermaid') {
          node.children[i] = { type: 'html', value: `<pre class="mermaid not-content">${escape(child.value)}</pre>` };
        } else visit(child);
      }
    }
    visit(tree);
  };
}
