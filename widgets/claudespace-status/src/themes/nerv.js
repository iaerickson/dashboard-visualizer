// themes/nerv.js — NERV/MAGI command-center visual style.
//
// One self-contained visual definition, nothing else. No widget logic, no
// icon components, no layout - just colors + typography, so this file can
// be handed to someone else (or a future you) as "here's the whole look"
// without dragging in anything functional.
//
// TO MAKE A NEW STYLE: copy this file to themes/<your-name>.js in this same
// folder and change the values. Every key below must be present - index.jsx
// reads all of them. Then point theme.config.js at your new file (see that
// file for how).

export default {
  label: "NERV/MAGI command center",

  // Core palette
  orange: "#ff6b1a",
  amber: "#ffb100",
  bg: "rgba(10, 9, 8, 0.92)",
  line: "rgba(255, 107, 26, 0.35)",
  text: "#eae3d6",
  textDim: "rgba(234, 227, 214, 0.5)",

  // Status/semantic colors (used by the custom icon set in index.jsx)
  statusGreen: "#5fd68a",
  statusBlue: "#7fb8d9",
  statusTeal: "#4fc7b8",
  statusRed: "#e8555a",
  statusPurple: "#b98fd6",

  // Typography
  fontFamily: `"Menlo", "SF Mono", "Courier New", monospace`,
}
