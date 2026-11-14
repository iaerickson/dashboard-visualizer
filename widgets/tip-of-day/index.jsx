import { css } from "uebersicht"
import { THEME } from "../src/theme.config"

// tip-of-day — Phase 3, second module for dashboard-visualizer (2026-08-03).
//
// Proves out the "each widget is its own folder/file" modular system this
// project's README calls out as already in place (see the Sub-projects
// checklist) — this is a genuinely separate Übersicht widget, own folder,
// own file, rendered independently of claudespace-status/index.jsx. It does
// not import from or modify that file at all, so there's zero risk to the
// existing live widget from adding this one.
//
// Content source (2026-08-03, first pass): cultureman and learnerman are
// both still empty (no real entries yet — see their own READMEs and the
// open question logged in NEEDS-IAN.md), so there's no real "bank of things
// the owner likes/found" to pull from yet. Rather than block this whole module on
// that, this first pass ships a small static list of dev/Claude-workflow
// tips — genuinely useful on their own, and an easy thing to swap out for
// real cultureman/learnerman content later (see TIPS below — that's the
// only thing that needs to change). Flagging this as a first-pass content
// choice for the owner's taste check, same as every other visual decision in this
// project so far — not meant to be the final word on what belongs here.
//
// Rotation: deterministic by day-of-year (no state, no command, no external
// script needed) — same tip all day, changes at local midnight, no two
// consecutive days repeat unless the list is short enough to wrap.
const TIPS = [
  "Claude's context window resets per conversation — for anything you'll want to reference again, put it in a file (README, NEEDS-IAN.md, PROCESS.md) instead of relying on chat history.",
  "If a task has a clear, mechanical fix, say so directly — \"just do X\" gets a faster, more literal result than leaving it open-ended.",
  "Scheduled tasks and on-demand skill runs share the same instructions — if something behaves differently between the two, that's a real bug worth flagging, not expected variance.",
  "When a project's Sub-projects checklist starts accumulating open questions instead of open tasks, that's usually a sign it needs a real decision pass before more gets built on top of it.",
  "Keyboard shortcut: Cmd+Shift+. in Finder toggles hidden files — handy when poking around config folders like Übersicht's own widgets directory.",
  "Small, single-purpose files age better than one large file that does everything — easier to reason about, easier to revert if one part goes wrong.",
  "If you're about to explain the same context to Claude for the third time, it probably belongs in a project's README instead.",
  "A stale checklist item isn't automatically wrong — check if it just needs the checkbox flipped before assuming it needs rework.",
  "Backups before format-conversion scripts aren't paranoia — Serato/rekordbox-style proprietary formats punish a bad write much harder than a bad read.",
  "The best time to write down *why* a decision was made is right when you make it — six weeks later it just looks arbitrary.",
  "Übersicht widgets are just files on disk — deleting one is as safe as deleting any other file, no special \"uninstall\" step needed.",
  "\"Good enough and shipped\" beats \"perfect and theoretical\" for almost anything that isn't irreversible.",
  "If an automation would touch something you can't easily undo, that's exactly the kind of thing worth a quick check-in first, not a default \"go.\"",
  "A rough time estimate with honest low confidence is more useful than a precise-sounding number that's really a guess.",
  "Naming things is genuinely hard — it's fine to run with a placeholder name for weeks while the actual project takes shape.",
  "When two projects start overlapping in scope, it's worth asking early whether they're really one system before both grow much further.",
  "Dry runs aren't just for risky scripts — running a preview pass on anything unfamiliar is cheap insurance against surprises.",
  "If a break feels hard to take because the work is genuinely fun, that's worth noticing — enjoyable and sustainable aren't automatically the same thing.",
  "Version control isn't just for collaboration — a plain `git init` on a solo project still gives you a real undo button.",
  "The clearest sign a process needs documenting: you're about to explain it out loud for the second time.",
]

const dayOfYear = (d) => {
  const start = new Date(d.getFullYear(), 0, 0)
  const diff = d - start
  return Math.floor(diff / 86400000)
}

export const refreshFrequency = 1800000 // 30 min — just needs to catch local-midnight rollover

export const className = `
  bottom: 20px;
  right: 40px;
  width: 330px;
`

const NERV_ORANGE = THEME.orange
const NERV_BG = THEME.bg
const NERV_LINE = THEME.line
const NERV_TEXT = THEME.text
const NERV_TEXT_DIM = THEME.textDim

const card = css`
  background: ${NERV_BG};
  border: 1px solid ${NERV_LINE};
  color: ${NERV_TEXT};
  font-family: ${THEME.fontFamily};
  padding: 10px 14px;
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
`

const label = css`
  color: ${NERV_ORANGE};
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 6px;
  opacity: 0.85;
`

const tipText = css`
  color: ${NERV_TEXT_DIM};
  font-size: 11px;
  line-height: 1.5;
`

export const render = () => {
  const now = new Date()
  const tip = TIPS[dayOfYear(now) % TIPS.length]

  return (
    <div className={card}>
      <div className={label}>[ Tip of the Day ]</div>
      <div className={tipText}>{tip}</div>
    </div>
  )
}
