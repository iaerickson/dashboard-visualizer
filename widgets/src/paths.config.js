// paths.config.js — THE ONE FILE TO EDIT to point the widget at your folders.
//
// Every shell command the widget runs (status summary, marking a report
// read, recording a break) builds its paths from the two values below.
// They are written as shell strings and always used inside double quotes,
// so `$HOME` expands at run time and no username is hardcoded anywhere.
//
// REPO_DIR         - where this repo (dashboard-visualizer) is checked out.
// CLAUDE_SPACE_DIR - the tracker folder the widget reads (INDEX.md etc.).
//
// Change either one to an absolute path if your layout differs, then quit
// and reopen Übersicht. Lives in src/ so Übersicht treats it as a module,
// not a separate widget (same reason as theme.config.js).

export const REPO_DIR = "$HOME/Desktop/Projects/dashboard-visualizer"
export const CLAUDE_SPACE_DIR = "$HOME/Desktop/ClaudeSpace"
