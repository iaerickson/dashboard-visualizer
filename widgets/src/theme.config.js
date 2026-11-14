// theme.config.js — THE ONE FILE TO EDIT to swap the widget's visual style.
//
// Per the owner (2026-07-31): rather than one file holding every theme's data in
// a big registry object, each visual style is its own self-contained file
// in ./themes/, and swapping is just changing which one this file points
// at - a "config file that gets generated per style, swapping is pointing
// the reference" rather than editing a shared object.
//
// Lives in src/ (2026-07-31): Übersicht's own README says any file inside a
// directory literally named node_modules, lib, or src is treated as a module,
// not a separate widget - the owner noticed this file and themes/nerv.js were
// showing up as their own entries in Übersicht's widget list alongside
// claudespace-status itself. Moving both under src/ makes Übersicht ignore
// them as widgets while still letting index.jsx import them normally.
//
// TO SWITCH THEMES: change the import path below to a different file in
// ./themes/, then quit and reopen Übersicht (same as any other widget
// file change).
//
// TO ADD A NEW THEME: create themes/<your-name>.js (copy themes/nerv.js as
// a starting template - every key it defines must be present), then point
// the import below at it. Switching back is changing this one line back -
// nothing is destroyed, every theme file you've made stays in ./themes/
// whether or not it's the active one.
//
// Scope note (unchanged from the original single-file version): only
// colors + font are themed this way. Icon shapes (IconActive, IconWarning,
// etc. in index.jsx) stay fixed across styles - a theme with genuinely
// different icon geometry, not just different colors, would need the
// icons themselves to become theme-specific lookups too. Not built -
// flag it in NEEDS-IAN.md if that's ever actually wanted.

export { default as THEME } from "./themes/nerv.js"
