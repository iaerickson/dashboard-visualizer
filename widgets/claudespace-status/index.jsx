import { css, run } from "uebersicht"
import { THEME } from "../src/theme.config"

// Copy-to-clipboard on click (2026-07-31, renamed from openInClaude - it no
// longer opens Claude). History: this used to also shell out to
// `open "claude://cowork/new?folder=..."` via Übersicht's `run()` helper
// after copying, to bring Claude Desktop forward with the folder pre-loaded.
// Dropped the `q` prefill param earlier the same day once it was confirmed
// (web search + Anthropic's own docs) that Claude Desktop's folder-trust
// dialog always wipes it - deliberate security behavior, not a bug, nothing
// this widget's code can route around. Ian's next live round: the `open`
// call itself was still firing on every click, popping the trust dialog each
// time even though the prefill inside it doesn't survive anyway - a jarring
// app-switch for no real payoff. Per his direct call ("remove that
// functionality for now"), the `open` call is commented out below rather
// than deleted - trivial to restore if a real fix for the trust-dialog
// problem ever surfaces. Clicking now ONLY copies to the clipboard (base64
// round-trip avoids shell-escaping issues with the prompt's own quotes/
// emoji) and flashes the row (`.copied-flash`) for ~1s so the click still
// gives real feedback.
const CLAUDE_SPACE_FOLDER = "/Users/ianerickson/Desktop/ClaudeSpace"

const copyPrompt = (promptText, el) => {
  // const folder = encodeURIComponent(CLAUDE_SPACE_FOLDER) // only needed if the `open` call below is restored
  const b64Prompt = btoa(unescape(encodeURIComponent(promptText)))
  if (el) {
    el.classList.add("copied-flash")
    setTimeout(() => el.classList.remove("copied-flash"), 1000)
  }
  run(`echo ${b64Prompt} | base64 -D | pbcopy`).catch(() => {})
  // Disabled 2026-07-31, per Ian - see comment above. To restore: uncomment
  // the `folder` line above and chain this after the copy resolves, same as
  // before:
  // .then(() => run(`open "claude://cowork/new?folder=${folder}"`).catch(() => {}))
}

// NOTE (2026-07-31 bugfix): the "uebersicht" module does NOT export a
// `keyframes` helper (only `css`/`styled` from its bundled Emotion) —
// importing it as undefined crashed the whole widget with "keyframes is
// not a function" and Übersicht silently dropped the module. Fix: define
// @keyframes as plain, literally-named blocks folded into `card`'s css
// (Emotion hoists nested @keyframes to the global stylesheet under their
// literal name, no helper needed) and reference them by that plain name
// in `animation:` elsewhere below.

// claudespace-status — Phase 2 widget for dashboard-visualizer.
//
// Sectioned, sorted project list (Active / Idea / Paused / Done) with
// counts, a full scrollable view per section, hover-to-expand per-project
// detail (summary, last completed, next steps, time estimate), a Needs
// Attention rollup (open NEEDS-IAN.md items + stale projects), plus the
// original at-a-glance numbers and usage-reset countdown from Phase 1.
//
// SETUP: requires Übersicht (free, open source, macOS 12+ —
// https://tracesof.net/uebersicht). This repo copy is the source of truth
// — see dashboard-visualizer/README.md for the one-time symlink setup that
// keeps this file live without manual re-copying.
//
// TINY/BIG MODE (2026-07-31, trigger mechanism revised twice on
// 2026-08-04): the card defaults to a compact "tiny" view (title + counts
// + a needs-Ian dot) and expands to the full "big" view (resets, needs-Ian
// detail, most-recent, sections, Needs Attention) on hover OR a click on
// the title (see `card`'s own `&.is-expanded .expand` rule).
//
// History, kept for context: three hover-only attempts, each one because
// the last still collapsed unexpectedly - (1) pure CSS `:hover`, flaky
// around scroll/reflow in the WebView; (2) `onMouseEnter`/`onMouseLeave`
// toggling a literal `is-expanded` class, still collapsed mid-transit
// moving between sections; (3) a 12-second collapse-grace-period timer,
// which fixed the boundary issues but introduced a NEW bug - hovering the
// title itself for long enough to cross a refresh tick could revert to
// mini with no mouse movement at all (root cause: Übersicht re-renders on
// every refreshFrequency tick regardless of hover, and a reshaped tree can
// birth a fresh DOM node mid-hover with none of the old node's classList
// history - a stationary cursor never re-fires mouseenter on it). Ian's
// first fix for that: replace hover entirely with a click toggle on the
// title. Tried live, then reversed the same day - "add hover back
// alongside click... both ways work" - so this is now BOTH: the whole
// card still hover-expands/collapses exactly like attempt (3) above (see
// `armCollapse`/`disarmCollapse`), and the title also has an explicit
// click toggle for a way in or out that doesn't depend on hover at all
// (see `toggleExpanded`). Both read/write the same `cardExpanded` flag, so
// whichever one fires last wins - clicking to collapse while still
// hovering stays collapsed until the pointer actually leaves and
// re-enters, or gets clicked again.
const COLLAPSE_GRACE_MS = 12000

// Module-level flag (2026-08-04). Tracks expanded/collapsed state in a
// plain module-level variable rather than relying solely on the DOM node's
// own classList - survives node replacement since it's just JS, not a DOM
// property. render() below bakes it directly into the className on every
// single render pass, so any freshly-created node (e.g. after an Übersicht
// refresh reshapes the tree - several siblings render conditionally, like
// `daily_goal &&`) is correctly classed from birth regardless of whether a
// fresh mouseenter ever fires on it - the same root cause noted above,
// just now handled at the state layer instead of by removing hover.
let cardExpanded = false

const setExpanded = (el, expanded) => {
  cardExpanded = expanded
  if (el) el.classList.toggle("is-expanded", expanded)
  // Reset the Skill Tray back to its closed pill state on every collapse
  // to mini mode, not just the first one - see `resetAllTrays`'s own
  // comment (defined further down, near the tray's other state helpers)
  // for the real bug this fixes.
  if (!expanded) resetAllTrays(el)
}

const armCollapse = (el) => {
  if (el._collapseTimer) clearTimeout(el._collapseTimer)
  el._collapseTimer = setTimeout(() => {
    setExpanded(el, false)
    el._collapseTimer = null
  }, COLLAPSE_GRACE_MS)
}

const disarmCollapse = (el) => {
  if (el._collapseTimer) {
    clearTimeout(el._collapseTimer)
    el._collapseTimer = null
  }
  setExpanded(el, true)
}

const toggleExpanded = (e) => {
  e.stopPropagation()
  // Uses the captured `cardNode` ref (see its own comment below) rather
  // than `e.currentTarget.parentElement` (2026-08-04) - that DOM-traversal
  // trick broke the moment `card` split into `cardOuter`/`cardInner`
  // (title's parent is now cardInner, one level short of the real root
  // that carries `is-expanded`). A captured ref doesn't care how many
  // wrapper levels sit in between.
  const cardEl = cardNode
  if (cardEl && cardEl._collapseTimer) {
    clearTimeout(cardEl._collapseTimer)
    cardEl._collapseTimer = null
  }
  setExpanded(cardEl, !cardExpanded)
}

// cardNode (2026-08-04) - captured via a plain ref callback (no hooks
// available in this environment - see this file's other module-level-flag
// comments for why direct DOM refs are already the established pattern
// here). Single source of truth `toggleExpanded`/`armCollapse`/
// `disarmCollapse` all target (see cardOuter's own comment for why the old
// `card` div split into cardOuter/cardInner).
//
// Used to measure resetsSection's own position for the Skills Tray's
// vertical placement (via a ResizeObserver, `positionSkillsTab`) - dropped
// 2026-08-04, per Ian: the tray's resting position needed to be flush with
// the CARD's own top edge, not resetsSection's bottom border (see
// trayColumn's own `top: 0` comment) - simpler and exact, no
// measurement needed at all anymore.
let cardNode = null

// ClaudeSpace path now passed explicitly (2026-08-05, real fragility fix) -
// per Ian's screenshot of the widget itself erroring "couldn't read
// tracker: ClaudeSpace folder not found at /Users/ianerickson/Desktop/
// Claude[Space]." status_summary.py falls back to `Path.home() /
// "Desktop" / "ClaudeSpace"` when no argument is given (see its own
// `claude_space = ...` line) - that resolves correctly under a normal
// shell, but this script's absolute path just above is ALREADY hardcoded
// rather than left to resolve at runtime, and the now-retired report-viewer
// widget already passed this same path explicitly rather than relying on
// the fallback - this file was the one inconsistent case. Removing the
// dependency on `Path.home()` resolving
// correctly in whatever environment Übersicht actually runs its `command`
// shell in closes off a real, if intermittent, failure mode rather than
// just hoping HOME is always set the way a normal Terminal session sets
// it.
export const command =
  "python3 '/Users/ianerickson/Desktop/Projects/dashboard-visualizer/scripts/status_summary.py' " +
  "'/Users/ianerickson/Desktop/ClaudeSpace'"

// The widget reads INDEX.md/NEEDS-IAN.md/READMEs directly, so anything
// that edits those files — including a log-pose run — shows up here
// automatically on the next refresh. No hook needed between them.
export const refreshFrequency = 20000

export const initialState = { loading: true }

export const updateState = (event, previousState) => {
  if (event.error) {
    return { loading: false, error: String(event.error) }
  }
  try {
    const data = JSON.parse(event.output)
    if (data.error) {
      return { loading: false, error: data.error }
    }
    return { loading: false, error: null, ...data }
  } catch (e) {
    return { loading: false, error: "couldn't parse status_summary.py output" }
  }
}

// Position (2026-07-31, per Ian: align with the top edge like the native
// Calendar/Weather desktop widgets, which sit close to the very top of the
// screen). Übersicht positions widgets absolute relative to the screen minus
// the menu bar, so `top` here is measured from just below the menu bar, same
// reference point those native widgets use - dropped from 40px to 12px to
// match their margin instead of sitting noticeably lower than them.
export const className = `
  top: 12px;
  right: 40px;
  width: 330px;
`

// --- Aesthetic (2026-07-31 pass, extracted to themes/nerv.js) ---
// Default theme ("nerv"): motifs pulled from Evangelion's computer-system
// overlays - matte black panels, hazard orange + off-white text, monospace
// type, angular clipped corners instead of rounded ones, thin hairline
// rules, bracketed labels, uppercase tracking, a slow ambient scanline
// pulse. No logos/copyrighted marks reproduced - just the palette + layout
// language. Colors live in their own file under widgets/src/themes/, with
// widgets/src/theme.config.js as the one pointer you edit to swap which
// theme file is active (Ian: "could be fun" to swap styles later) - see
// those two files for how to add or switch styles. Moved 2026-08-04 from a
// per-widget src/ folder to a shared top-level widgets/src/ so every widget
// (claudespace-status, tip-of-day, and future ones) can import the exact
// same palette - still named literally "src" so Übersicht doesn't list it
// as its own separate widget (see theme.config.js's own comment for why).
const NERV_ORANGE = THEME.orange
const NERV_AMBER = THEME.amber
const NERV_BG = THEME.bg
const NERV_LINE = THEME.line
const NERV_TEXT = THEME.text
const NERV_TEXT_DIM = THEME.textDim
const STATUS_GREEN = THEME.statusGreen
const STATUS_BLUE = THEME.statusBlue
const STATUS_TEAL = THEME.statusTeal
const STATUS_RED = THEME.statusRed
const STATUS_PURPLE = THEME.statusPurple

// --- Custom icon set (2026-07-31) ---
// Replaces plain unicode emoji (🟢🟡⏸️✅🚧🤔⚠🗑️) with small hand-drawn line-art
// SVGs matching the widget's own aesthetic (angular, thin stroke, desaturated
// semantic colors) instead of each OS's built-in emoji glyphs, which read as
// "cheap"/inconsistent next to the rest of the custom design. Not sourced
// from any icon library or generator (no image-gen tool available in this
// session, and nothing relevant in the plugin marketplace either, checked
// 2026-07-31) - these are just small inline SVGs, geometry chosen to be
// simple enough to hand-verify at this size (12x12). Colors are baked into
// each icon rather than using currentColor, since each one has exactly one
// semantic meaning everywhere it's used in this file (e.g. IconBlocked is
// always the "blocked" red) - simpler than threading color props through
// every call site.
const iconStyle = { display: "inline-block", verticalAlign: "-2px", flexShrink: 0 }

const IconActive = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <circle cx="6" cy="6" r="4.9" stroke={STATUS_GREEN} strokeWidth="1.3" fill="none" />
    <circle cx="6" cy="6" r="2" fill={STATUS_GREEN} />
  </svg>
)

const IconIdea = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <g stroke={NERV_AMBER} strokeWidth="1.3" strokeLinecap="round">
      <line x1="6" y1="1" x2="6" y2="11" />
      <line x1="1.6" y1="3.5" x2="10.4" y2="8.5" />
      <line x1="10.4" y1="3.5" x2="1.6" y2="8.5" />
    </g>
  </svg>
)

const IconPaused = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <rect x="2.4" y="1.5" width="2.1" height="9" rx="0.4" fill={STATUS_BLUE} />
    <rect x="7.3" y="1.5" width="2.1" height="9" rx="0.4" fill={STATUS_BLUE} />
  </svg>
)

const IconDone = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <path d="M6 1L11 6L6 11L1 6Z" stroke={STATUS_TEAL} strokeWidth="1.1" fill="none" />
    <path
      d="M3.6 6.1L5.2 7.7L8.5 4.2"
      stroke={STATUS_TEAL}
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
)

// IconGoalDone (2026-08-04, per Ian: "maybe the goal can be crossed off
// once it's achieved and a little success or good icon takes its place").
// A four-point sparkle rather than reusing IconDone's diamond-check - this
// marks a specific daily moment ("today's goal, hit"), not the same thing
// as a project reaching the Done status, so it gets its own small
// celebratory shape instead of borrowing that one's meaning. Primary
// NERV_ORANGE (not teal) to match the "bold it out in primary colors"
// treatment this same round gave the Last Touched row.
const IconGoalDone = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <path
      d="M6 0.5L7.1 4.4L11 5.5L7.1 6.6L6 10.5L4.9 6.6L1 5.5L4.9 4.4Z"
      fill={NERV_ORANGE}
    />
  </svg>
)

// IconGoal (2026-08-04) - simple concentric target glyph for the new "Daily
// Goals" section header, matching every other section's own small icon
// (Active's ring, Idea's spark, etc.) now that the goal panel is a real
// collapsible Section instead of a one-off styled block. See DailyGoals'
// own comment near the Section component for the full restyle context.
// Simplified (2026-08-04), per Ian: "the mini goal bullets are a nice
// touche but theyre too big they should be smaller and try to have it
// match similar style standard." The original 3-concentric-circle target
// had noticeably more visual ink than every other single-ring icon in this
// file (IconActive, IconDormant, etc.) even at the same pixel size - that
// extra weight was what actually read as "too big," not the literal size
// prop. Now a plain ring + center dot, matching IconActive's own shape and
// weight exactly (just orange instead of green).
const IconGoal = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <circle cx="6" cy="6" r="4.6" stroke={NERV_ORANGE} strokeWidth="1.2" fill="none" />
    <circle cx="6" cy="6" r="1.6" fill={NERV_ORANGE} />
  </svg>
)

const IconWarning = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <path d="M6 1.3L11 10.4H1Z" stroke={NERV_ORANGE} strokeWidth="1.1" strokeLinejoin="round" fill="none" />
    <line x1="6" y1="4.4" x2="6" y2="7.1" stroke={NERV_ORANGE} strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="6" cy="8.7" r="0.55" fill={NERV_ORANGE} />
  </svg>
)

const IconBlocked = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <circle cx="6" cy="6" r="4.8" stroke={STATUS_RED} strokeWidth="1.1" fill="none" />
    <line x1="2.6" y1="9.4" x2="9.4" y2="2.6" stroke={STATUS_RED} strokeWidth="1.1" />
  </svg>
)

const IconAsk = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <path
      d="M4 4.2C4 3 5 2.1 6.1 2.1C7.2 2.1 8.1 2.9 8.1 3.9C8.1 5.2 6.3 5.3 6.3 6.9"
      stroke={NERV_TEXT}
      strokeWidth="1.1"
      strokeLinecap="round"
      fill="none"
    />
    <circle cx="6.3" cy="9.2" r="0.6" fill={NERV_TEXT} />
  </svg>
)

// Replaces the old 🗑️ trash icon for "hasn't been touched in a while." Trash
// implies "delete this," which isn't the point (see Ian's 2026-07-31 note -
// low-priority isn't the same as abandoned) - a clock reads as "time has
// passed" without that judgment. Muted/dim color on purpose, matching the
// "informational, not urgent" intent - see the "dormant" wording change
// throughout this file (was "stale").
const IconDormant = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <circle cx="6" cy="6" r="4.8" stroke={NERV_TEXT_DIM} strokeWidth="1.1" fill="none" />
    <path
      d="M6 3.3V6.1L8 7.4"
      stroke={NERV_TEXT_DIM}
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
)

// Backlog (2026-07-31, per Ian: "we still need a backlog section here too") -
// a small stacked-tray icon (two shallow trapezoids) reads as "queued/set
// aside," distinct from Active's ring, Idea's spark, Paused's bars, Done's
// check, and Dormant's clock.
const IconBacklog = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <path d="M1.5 4.5L6 2.5L10.5 4.5L6 6.5Z" stroke={STATUS_PURPLE} strokeWidth="1.1" strokeLinejoin="round" fill="none" />
    <path d="M1.5 7.5L6 9.5L10.5 7.5" stroke={STATUS_PURPLE} strokeWidth="1.1" strokeLinejoin="round" fill="none" />
  </svg>
)

// Bin (2026-08-04, per Ian: "another section i want for the project tracker
// is a bin/trash to discard ideas we don't wanna do anymore and keep track
// of stuff that way"). A plain trash-can outline - the one icon in this set
// that's fine being literal/unambiguous rather than abstract, since "bin"
// is exactly the right mental model here (discarded but not deleted - see
// _bin/BIN.md's own convention doc). Dim/muted color (NERV_TEXT_DIM, same
// as IconDormant) rather than a red/alarm tone - being in the bin isn't an
// urgent or negative state, just an inactive one, same reasoning as
// Dormant's own muted treatment.
const IconBin = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <path
      d="M2.5 3.5H9.5L8.9 10.2C8.87 10.5 8.6 10.7 8.3 10.7H3.7C3.4 10.7 3.13 10.5 3.1 10.2L2.5 3.5Z"
      stroke={NERV_TEXT_DIM}
      strokeWidth="1"
      strokeLinejoin="round"
      fill="none"
    />
    <line x1="1.5" y1="3.5" x2="10.5" y2="3.5" stroke={NERV_TEXT_DIM} strokeWidth="1.1" strokeLinecap="round" />
    <line x1="4.5" y1="3.5" x2="4.8" y2="1.8" stroke={NERV_TEXT_DIM} strokeWidth="1" strokeLinecap="round" />
    <line x1="7.5" y1="3.5" x2="7.2" y2="1.8" stroke={NERV_TEXT_DIM} strokeWidth="1" strokeLinecap="round" />
    <line x1="4.8" y1="1.8" x2="7.2" y2="1.8" stroke={NERV_TEXT_DIM} strokeWidth="1" strokeLinecap="round" />
  </svg>
)

// IconHeartbeat (2026-07-31, per Ian: "a little cool icon for brain or
// health or a little body outline" on the new personal-health gauge). Went
// with an EKG/pulse line over a brain or body outline - both of those need
// more curve detail than reads cleanly at this file's established 12x12
// icon size (see the other Icon* components above), while a pulse zigzag is
// simple, unambiguous at a glance, and fits the "monitor" framing of the
// gauge itself. Amber rather than red - red already means "urgent/blocked"
// everywhere else in this file (IconBlocked, Needs Attention), and this
// icon shouldn't borrow that alarm meaning; the gauge's own HSL fill
// already carries the real urgency signal as it depletes.
// `color` prop added (2026-07-31, per Ian: "break icon should be in mini
// mode and have a similar color change correspondence where it starts green
// if closer to fresh start and changes color closer to necessary break") -
// optional, defaults to the static amber used in big mode's gauge label so
// that call site is unaffected; the new mini-mode pill below passes the
// same HSL hue the gauge itself uses, computed from remainingFraction.
// IconSession / IconUsage (2026-08-04), per Ian: "if there are icons we can
// use for session and weekly usage that would be nice so that break session
// and usage can all be aligned." Only Last Break had an icon before this -
// these two match its size/muted-dim treatment so all three gauges read as
// one consistent set instead of Last Break looking like a one-off.
const IconSession = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <circle cx="6" cy="6.7" r="4.1" stroke={NERV_TEXT_DIM} strokeWidth="1.1" fill="none" />
    <path d="M6 6.7V4.3" stroke={NERV_TEXT_DIM} strokeWidth="1.1" strokeLinecap="round" />
    <path d="M4.6 1.3H7.4" stroke={NERV_TEXT_DIM} strokeWidth="1.1" strokeLinecap="round" />
  </svg>
)

const IconUsage = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <rect x="1.3" y="6.5" width="2" height="4" fill={NERV_TEXT_DIM} />
    <rect x="5" y="3.5" width="2" height="7" fill={NERV_TEXT_DIM} />
    <rect x="8.7" y="1.3" width="2" height="9.2" fill={NERV_TEXT_DIM} />
  </svg>
)

const IconHeartbeat = ({ size = 12, color = NERV_AMBER }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <path
      d="M0.8 6H3.2L4.3 2.2L6.7 9.8L7.8 6H11.2"
      stroke={color}
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
)

// IconSleep (2026-08-02, per Ian: "change the icon to a little z's or
// sleeping to signify I am away"). A single "Z" reads clearly as sleep/away
// at this file's 12x12 icon size - a literal zzz or moon-and-stars needs
// more detail than survives that small (same reasoning IconHeartbeat's own
// comment gives for skipping a brain/body outline). Blue rather than amber
// or red - matches IconPaused's color, since "away" and "paused" are the
// same underlying idea here (not counting against anything right now).
const IconSleep = ({ size = 12, color = STATUS_BLUE }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" style={iconStyle}>
    <path
      d="M2.5 3H8.5L2.5 9H8.5"
      stroke={color}
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
)

// Idle ambient activity (2026-07-31, per Ian: "add more little animations...
// blinking stuff to make Commandspace feel more like the NERV MAGI computers,
// or just feel like there is some activity happening or processing even if
// idle" - purely decorative, doesn't reflect any real backend state, same
// spirit as the title's existing pulsing ◆). Two additions here: `position:
// relative` + `overflow: hidden` so a sweep line can live inside the card's
// own clipped shape without escaping it (needed for the ::before sweep
// below); a slow scanline sweeps top-to-bottom on a loop, low-opacity so it
// reads as ambient texture, not a distraction. The `sweep` keyframe (like
// `fadeIn`/`scan`) gets hoisted globally by Emotion under its literal name,
// so other elements outside `card`'s own box can reference it too if wanted
// later.
// cardOuter / cardInner split (2026-08-04) - was one `card` div until the
// Skills Tray needed to be "treated as part of big mode that expands and
// collapses at the exact same time" (Ian, live, after seeing the tray pop
// in/out on its own separate timing and briefly linger after a mini-mode
// collapse - a real desync bug, not just a style nitpick). The old single
// div HAD to keep `overflow: hidden` (needed for the ambient sweep
// animation and the clipped-corner `clip-path` shape), which meant
// anything meant to visually poke outside its bounds - like a tray bump -
// could only exist as a totally separate SIBLING with its own JS-driven
// mount/unmount and its own animation, decoupled from the card's real
// expand state. That decoupling was the actual bug: two independently
// timed things trying to look like one.
// Split fixes it structurally instead of patching the symptom again:
// `cardOuter` is a plain `position: relative` wrapper with NO overflow
// clipping and owns the single source of truth (`is-expanded`, toggled by
// `setExpanded`/`toggleExpanded`/`armCollapse`/`disarmCollapse` - unchanged
// logic, just retargeted from the old `card` div to this one). `cardInner`
// keeps every visual property the old `card` had (background/clip-path/
// overflow/sweep/border/box-shadow) unchanged - it's still what actually
// LOOKS like the card. SkillsTray now renders as a normal DOM CHILD of
// cardOuter, a sibling of cardInner rather than of the whole widget -
// close enough to escape cardInner's clipping (it's not nested inside
// cardInner at all) while still being a real child that inherits
// cardOuter's own `is-expanded` state via plain CSS, no separate JS
// mount/unmount, no separate animation timing, no lingering possible.
const cardOuter = css`
  position: relative;

  /* Real bug (2026-07-31), per Ian: "navigating items towards the bottom of
     the scroll... quickly go back to mini... shouldn't collapse unless the
     pointer exits the boundary of the big mode dimensions." Pure CSS :hover
     was the trigger here, which is SUPPOSED to only react to the pointer's
     actual screen position relative to this element's rendered box - but
     that's exactly the class of thing that gets flaky around scroll/reflow
     in a WebView (the 280ms exit-delay on expandWrap below was an earlier
     patch for the same symptom, not a full fix). Switched to an explicit,
     deterministic trigger instead: onMouseEnter/onMouseLeave on this
     element's own root (see render()) toggle a literal is-expanded class
     via classList - real DOM boundary-crossing events, not a CSS
     pseudo-class re-derived every frame, so "collapse only when the
     pointer truly leaves this element's box" is guaranteed by the
     browser's own event model rather than approximated. No Accessibility
     permission needed for this (that concern, noted elsewhere in this
     file, is about OS-level click-to-expand outside the WebView -
     mouseenter/mouseleave are plain in-page DOM events, same category as
     every other classList toggle already used throughout this file). Now
     living on cardOuter (not cardInner) so it also covers SkillsTray,
     which is a sibling of cardInner but still a real child of this
     element - hovering the tray bubbles up to this same listener, no
     separate wiring needed. */
  &.is-expanded .expand {
    grid-template-rows: 1fr;
    opacity: 1;
    pointer-events: auto;
    margin-top: 12px;
    transition-delay: 0s;
  }
`

const cardInner = css`
  position: relative;
  overflow: hidden;
  background: ${NERV_BG};
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
  padding: 16px 18px;
  font-family: ${THEME.fontFamily};
  color: ${NERV_TEXT};
  border: 1px solid ${NERV_LINE};
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 4px 28px rgba(255, 107, 26, 0.08);
  transition: all 0.4s ease;

  &::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 46px;
    top: -46px;
    background: linear-gradient(180deg, transparent, rgba(255, 107, 26, 0.06), transparent);
    animation: sweep 8s linear infinite;
    pointer-events: none;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-2px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes scan {
    0% { opacity: 0.35; }
    50% { opacity: 0.8; }
    100% { opacity: 0.35; }
  }
  @keyframes sweep {
    0% { top: -46px; }
    100% { top: 100%; }
  }

  /* Click confirmation (2026-07-31) - see copyPrompt()'s comment above for
     why this exists (the composer prefill doesn't survive the folder-trust
     dialog, so this is the real feedback a click happened at all). Plain
     literal class toggled via classList in JS, not an emotion-generated
     name, same "literal class alongside hash" trick as .expand/.nested/
     .detail elsewhere in this file - nested here so Emotion scopes it under
     this element's own hashed class. */
  .copied-flash {
    background: rgba(255, 107, 26, 0.28) !important;
    color: ${NERV_ORANGE} !important;
  }
  .copied-flash::after {
    content: " ✓ copied — ⌘V in Claude";
    font-size: 9px;
    opacity: 0.85;
    margin-left: 4px;
  }
`

const tinyRow = css`
  display: flex;
  align-items: center;
  gap: 11px;
  font-size: 12px;
`

const tinyStat = css`
  display: flex;
  align-items: center;
  gap: 3px;
  color: ${NERV_TEXT_DIM};

  & strong {
    color: ${NERV_AMBER};
    font-weight: 600;
    font-size: 13px;
  }
`

// tinyStat variant for the two attention pills (open items, dormant projects) -
// same pill shape as the four status counts, orange number instead of amber,
// so they read as part of the same at-a-glance row rather than a separate
// callout.
const tinyStatWarn = css`
  display: flex;
  align-items: center;
  gap: 3px;
  color: ${NERV_TEXT_DIM};

  & strong {
    color: ${NERV_ORANGE};
    font-weight: 600;
    font-size: 13px;
  }
`

// Smoother expand animation (2026-07-31, per Ian: "any option to make the
// render on the expand animation more fluid/visually easy/smooth"). The old
// approach animated max-height: 0 -> a guessed cap (600px here), which always
// runs the full transition duration regardless of how much content actually
// exists - a short list "finishes" growing almost instantly and the
// transition keeps running against empty space, which reads as slightly off.
// Fixed with the CSS grid 0fr -> 1fr technique: the OUTER wrapper is
// `display: grid; grid-template-rows: 0fr` and animates to `1fr`, which
// interpolates to the actual measured height of its one child row - no
// guessing. The INNER wrapper (`expandInner` below) still owns `overflow-y:
// auto` + a real `max-height` cap, so long lists still scroll instead of
// growing unbounded; the grid track's height is simply "however tall that
// capped inner box ends up being," which the browser animates to smoothly
// either way. Also swapped the easing curve to a softer "expo-out" feel
// (`cubic-bezier(0.16, 1, 0.3, 1)`) in place of the previous standard
// "material" curve, per the same ask.
// Collapse exit-delay (2026-07-31, per Ian: "the sensitivity to collapse back
// into mini mode is a little fickle... scrolling down a big list, as I get to
// the bottom it seemingly collapses to mini kind of easily"). Root cause not
// fully provable from here (Übersicht's outer widget container isn't
// something this file can inspect directly), but the likely mechanism: the
// card's real hover hit-box is whatever Übersicht sized the outer widget
// element to, and scrolling a long list near its bottom edge is exactly where
// the mouse is most likely to briefly cross that boundary or catch a momentary
// hit-test gap. Same fix already proven elsewhere in this file for the
// opposite direction (collapsibleSection's enter-delay, "hover intent"): put
// a delay on ONE side of the transition only. Here it's the leave/collapse
// side - entering stays instant (see card's `&:hover .expand` rule, explicit
// `transition-delay: 0s`), but leaving now waits ~280ms before actually
// starting to collapse. If the mouse re-enters within that window (e.g. a
// brief scroll-related blip), the pending collapse never starts - CSS cancels
// and reverses a still-pending transition automatically, no JS needed.
const expandWrap = css`
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  margin-top: 0;
  pointer-events: none;
  transition: grid-template-rows 0.5s cubic-bezier(0.16, 1, 0.3, 1) 280ms, opacity 0.35s ease 280ms,
    margin-top 0.5s cubic-bezier(0.16, 1, 0.3, 1) 280ms;
`

const expandInner = css`
  overflow-y: auto;
  overflow-x: hidden;
  /* 600px -> 760px (2026-07-31): moving the widget's top offset up from 40px
     to 12px freed up real vertical room before the bottom of the screen, so
     big mode can afford to show more before its internal scrollbar kicks in. */
  max-height: 760px;
  min-height: 0;

  &::-webkit-scrollbar {
    width: 5px;
  }
  &::-webkit-scrollbar-thumb {
    background: ${NERV_LINE};
    border-radius: 2px;
  }
`

const title = css`
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: ${NERV_ORANGE};
  margin: 0 0 10px 0;
  display: flex;
  align-items: center;
  gap: 6px;

  &::before {
    content: "◆";
    font-size: 9px;
    animation: scan 2.4s ease-in-out infinite;
  }
  &::after {
    content: "";
    flex: 1;
    height: 1px;
    background: ${NERV_LINE};
    margin-left: 4px;
  }
`

// Daily Goals section (2026-08-04) - restyled from a single bold-orange
// line into a proper collapsible Section, per Ian: "can the goal for the
// day be a list as well and have daily goals as a header. I want it to
// look nicer and be more readable. also daily goals should be another
// thing that is collapsable/expandable. most new implementations to
// command space should follow this pattern generally." This is now the
// reference shape for adding anything new here, not just the goal panel's
// own fix - see the DailyGoals component itself (near Section, below) for
// how it reuses sectionHeader/collapsibleSection/nestedList rather than a
// bespoke one-off block.
// Still purely a DISPLAY - the actual goal list and target come from
// config/daily_goal.json, written by the goal-for-day skill (see that
// project's SKILL.md), never generated here (same free/deferred split as
// everything else in this file).
//
// Bold-orange text walked back the same day, per Ian's direct follow-up:
// "scratch what i said about the orange have it match the style of the
// other collapseabile sections and have brief summary that can be
// explandable and have it clickable so that i can work on it in a new
// thread." Individual goal rows now reuse `attentionRow` as-is (see
// GoalRow, near AttentionEntryRow below) instead of a bespoke bold-orange
// line - same plain dim text + click-to-expand-detail + click-to-copy-a-
// working-prompt shape every other row in this file already has, just
// with an orange hover tint instead of Needs Attention's red. No
// goalItem/goalItemDone CSS needed anymore as a result.
const goalItemDone = css`
  color: ${NERV_TEXT_DIM};
  text-decoration: line-through;
`

// Reverted (2026-08-04) back to its original plain/dim styling, per Ian:
// "keep last touched how it was" - a same-round bold/orange pass got
// walked back once he clarified the orange-bold treatment was meant for
// the new goal panel above, not this row too.
const recent = css`
  margin-top: 8px;
  font-size: 11px;
  color: ${NERV_TEXT_DIM};
  text-transform: uppercase;
  letter-spacing: 0.03em;
`

const resetsSection = css`
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid ${NERV_LINE};
`

// Made inline (2026-08-04), per Ian: even after shortening this text
// (previous round), a gauge WITH a stale/reset message still rendered one
// line taller than a gauge without one - Last Break and Session never quite
// matched heights depending on which state each happened to be in. Moved
// from its own block line below the value to inline, appended directly
// after valueText on the SAME line (see ResetGauge's render below) - every
// gauge's row is now exactly bar + one value line, always, whether or not
// this text is present. Kept short (see call sites) so it never wraps
// inside resetBarCol's fixed 150px width even combined with valueText.
const resetStale = css`
  font-size: 9px;
  color: ${NERV_ORANGE};
  margin-left: 5px;
  letter-spacing: 0.02em;
  white-space: nowrap;
`

// Reset gauge layout (2026-07-31, per Ian: with only the session bar built,
// "not clear which is which" between it and weekly usage - both trackers now
// get their own gauge, label on the left, bar + value stacked and
// right-aligned underneath it on the right, so each bar sits directly under
// its own reading instead of floating ambiguously between two labels).
// Alignment fix (2026-07-31, per Ian, live: "bars on same level as their
// associated value... time approx directly under, small, right align" - the
// first version used align-items: flex-end, which aligns by the BOTTOM of
// each column - since the label is one short line and the bar+value column
// is taller, that pushed the bar up above the label's own line instead of
// level with it. flex-start aligns both columns by their TOP instead, so the
// bar sits right at the label's own line, with the value trailing directly
// underneath it.
const resetItem = css`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;

  &:last-child {
    margin-bottom: 0;
  }
`

const resetItemLabel = css`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${NERV_TEXT_DIM};
`

// Fixed icon slot (2026-08-04), per Ian: "i dont like that the icon
// displaces last break in" - back when only Last Break carried an icon,
// its label text started further right than Session/Weekly Usage's own
// text (which began flush at the row's left edge with no icon before it).
// Now that all three gauges get an icon (see IconSession/IconUsage above),
// this reserves a fixed-width slot for it regardless of whether a given
// row happens to pass one, so every label's TEXT starts at the exact same
// x position - alignment no longer depends on icon presence.
const resetItemIconSlot = css`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  flex-shrink: 0;
`

const resetBarCol = css`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  width: 150px;
  flex-shrink: 0;
`

const resetValueRight = css`
  color: ${NERV_TEXT};
  font-weight: 500;
  font-size: 11px;
`

const sectionsWrap = css`
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid ${NERV_LINE};
`

// Alignment fix (2026-07-31, per Ian: "the alignment of subspace headers are
// not even"). Root cause: the "[ ... ]" brackets were a ::before/::after pair
// on the FLEX CONTAINER itself, which makes them their own flex items - so
// justify-content: space-between was distributing 4 items (bracket, label,
// count, bracket) rather than 2, and the label's position drifted depending
// on how long its own text was (ACTIVE vs NEEDS ATTENTION are very different
// widths). Fixed by moving the brackets onto the two real spans instead
// (label span gets a "[ " ::before, count span gets a " ]" ::after) - back to
// exactly 2 flex items, so space-between always pins the label flush left and
// the count flush right regardless of text length.
// Spacing fix (2026-08-04), per Ian: "spacing on bin and dormant doesnt
// look equal to all the others." Root cause: this used MARGIN, which
// collapses between adjacent sibling block boxes - two zero-item sections
// back to back (Dormant, Bin - neither renders a list underneath) had
// nothing but empty wrapper divs between their headers, so their margins
// collapsed into a single, smaller gap (max of the two, not the sum).
// Sections with real content between them (or just one empty neighbor)
// never hit this because the intervening element broke the collapse chain -
// hence some gaps looking "normal" and only Dormant->Bin looking tight.
// Padding never collapses, so switching to it makes every section's own
// reserved space fully self-contained and identical regardless of what's
// next to it - deterministic 8px-above/4px-below spacing everywhere, not
// dependent on sibling emptiness.
const sectionHeader = css`
  position: relative;
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${NERV_ORANGE};
  padding: 8px 0 4px 0;
`

const sectionHeaderLabel = css`
  &::before {
    content: "[ ";
    color: ${NERV_LINE};
  }
`

const sectionHeaderCount = css`
  &::after {
    content: " ]";
    color: ${NERV_LINE};
  }
`

// Spacing fix (2026-07-31, per Ian: "these subspaces need to be spaced
// equal, the 4 recently done doesn't need to push space or change that -
// have it be inline... or hanging in that space"). This used to be a normal
// block below the header, adding its own line of real layout height - the
// Done→Dormant gap ended up visibly bigger than every other section's gap
// as a direct result. Absolutely positioned now, hanging just under
// sectionHeader's own count (sectionHeader is `position: relative`, see
// above) - removed from normal flow entirely, so it can't add height and
// every section's spacing stays governed by sectionHeader's own margin alone,
// identical whether a subnote is present or not.
const sectionSubnote = css`
  position: absolute;
  right: 0;
  top: 100%;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.35);
`

// Hover-intent added here too (2026-07-31), per Ian: "interior items inside
// of idea active open almost immediately on hover, can we slow that down a
// little." This was deliberately instant (transition-delay: 0s) up to now -
// matches every other hover-intent value already in this file (260ms, the
// same number used for nestedList/detail's own exit-delay elsewhere).
const projectItem = css`
  position: relative;
  font-size: 12px;
  color: ${NERV_TEXT};
  padding: 3px 6px;
  transition: background 0.25s ease, border-color 0.25s ease;
  animation: fadeIn 0.4s ease;
  border-left: 2px solid transparent;

  &:hover .detail {
    transition-delay: 260ms;
    grid-template-rows: 1fr;
    opacity: 1;
    pointer-events: auto;
    margin-top: 6px;
  }
  &:hover .detailInner {
    padding: 6px 8px;
  }
`

// Per-section hover color (2026-07-31, per Ian: "just want to test out" the
// highlighted row taking on its own section's color - active green (its
// icon's color), idea yellow/amber, paused blue, done teal (the closest
// established "green" - Done's own icon already uses this, not a second
// pure-green), Needs Attention red. `color-mix()` keeps this to one color
// value per call instead of a separate hex->rgba conversion per section -
// same modern-Safari/WKWebView assumption already made for Übersicht
// elsewhere in this file. Split out from projectItem's own hover rule
// (which still owns the .detail/.detailInner reveal, unrelated to color) so
// each Section can pass its own SECTION_META color down as a second class.
const hoverTint = (color) => css`
  &:hover {
    background: color-mix(in srgb, ${color} 14%, transparent);
    border-left: 2px solid ${color};
  }
`

// Renamed from "stale" to "dormant" in display text (2026-07-31, per Ian):
// this flag just means "hasn't been touched in 30+ days with no checked
// items/notes" (see system-healthcheck's proposed definition) - a recency
// signal, not a priority/importance judgment. "Stale" reads as "should be
// thrown out"; a low-priority-but-still-wanted project (Ian's example:
// jrpg-portfolio) shouldn't look condemned just for being quiet a while.
// Muted color to match - this isn't meant to alarm. (Underlying data field
// is still called "stale" - system-healthcheck's own naming, a separate,
// bigger cross-project convention not being renamed here.)
const staleTag = css`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: ${NERV_TEXT_DIM};
  font-size: 10px;
  margin-left: 5px;
  text-transform: uppercase;
`

// In-place accordion detail panel (2026-07-31 bugfix), replacing an absolutely-
// positioned side tooltip. The old tooltip (position: absolute; left: 100%) got
// silently clipped by expandWrap's `overflow: hidden` (needed for its own
// collapse animation) - and would have had the same problem again once section
// lists became scrollable below (overflow-y: auto forces overflow-x to auto too,
// per the CSS spec, which would've clipped it from the other axis as well). An
// in-place expand that grows within normal document flow sidesteps both: nothing
// needs to escape any ancestor's box.
//
// Grid-based reveal (2026-07-31, same fix as expandWrap above) - `detail` is
// the outer grid track (0fr -> 1fr, animates to the real content height) plus
// the border-left accent (a 0-height box still renders a 0-length border, so
// this is invisible while collapsed, same as before). `detailInner` is the new
// inner wrapper - it owns the padding, which still animates on its own (0 8px
// -> 6px 8px) since that's a real visual "breathing room" effect worth
// keeping independent of the height reveal.
// Trunk-bar continuity fix (2026-07-31), per Ian's screenshot: "the two side
// bars are wholly unconnected." Root cause, found by tracing actual pixel
// math rather than eyeballing it again: projectItem's own hover border-left
// (the per-section-color row highlight) renders at ITS box's true left edge -
// x=0 of the row. detail, as a plain child sitting inside projectItem's own
// padding (3px 6px), started 8px further right (2px of projectItem's own
// border-width + 6px of its padding) - so detail's border-left was a SECOND,
// separately-positioned vertical line, offset 8px right of the row's, and
// only spanning detail's own height (i.e. starting below the name line, not
// from the top of the row). Two visibly disconnected segments, exactly what
// Ian flagged. Fixed the same way stepsWrap already reconnects to detail's
// own border below: margin-left: -8px pulls detail's border out to x=0,
// exactly overlapping projectItem's row-level border into ONE continuous
// line from the top of the hovered row down through the whole expanded
// panel; padding-left originally 8px (matching detailInner's own padding,
// to keep content position visually unchanged after the margin shift), then
// reduced to 2px in a later pass to fix a real overflow-clipping bug found
// live (not a style tweak) - the connector geometry that padding value was
// originally tuned for is gone now (see the Next-steps rows comment below,
// 2026-08-04 - the whole connector/tracking-dot mechanism was removed), but
// the padding value itself stays, it's load-bearing for this border's own
// alignment independent of that.
// Same exit-delay treatment as nestedList (2026-07-31, preventative - see
// nestedList's own comment for the live bug this addresses at the section
// level; this is the same reveal mechanism one level down, for individual
// project/attention rows, so it gets the same fix before it can show the
// same symptom moving row-to-row).
const detail = css`
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
  margin-top: 0;
  margin-left: -8px;
  padding-left: 2px;
  border-left: 2px solid ${NERV_ORANGE};
  transition: grid-template-rows 0.35s cubic-bezier(0.16, 1, 0.3, 1) 260ms, opacity 0.25s ease 260ms,
    margin-top 0.35s ease 260ms;
`

const detailInner = css`
  overflow: hidden;
  min-height: 0;
  padding: 0 8px;
  font-size: 11px;
  line-height: 1.5;
  color: ${NERV_TEXT};
  background: rgba(255, 107, 26, 0.06);
  transition: padding 0.35s ease;
`

// NOTE (2026-07-31): originally gave each section its OWN scrollable box
// (max-height + overflow-y), but that meant nested scrollbars once the
// outer .expand region also needed to scroll (25 idea items alone would
// blow well past any reasonable fixed height for the whole card). Simpler
// UX: one scroll region for the whole expanded card (see card's
// `&:hover .expand` rule), this is now just a plain grouping wrapper.
const scrollList = css`
  padding-right: 2px;
`

// Per-section nested collapse (2026-07-31, later made universal per Ian:
// "keep all sub spaces collapsed until hover"): every section (Active,
// Idea, Paused, Done) and Needs Attention default collapsed to just their
// header within big mode - hovering that specific section reveals its
// list, and it stays open as long as the mouse is anywhere within the
// section's own box (standard CSS descendant :hover - no JS/timer needed,
// same pattern as the card-level and per-project reveals elsewhere in this
// file). Originally Active was left always-visible while the rest were
// collapsible; unified to all-collapsed after seeing it live.
// Hover-intent delay (2026-07-31, per Ian: "a slight delay so I can move over
// sub headers without immediately triggering... a natural fluid movement down
// can get there and not trigger right away"). transition-delay is set in the
// :hover rule for the ENTRY side - when the mouse enters, this rule's delay
// governs the transition to the expanded state, so quickly passing over a
// header on the way to a different one never gets far enough into the delay
// to visibly expand. Bumped 220ms -> 380ms (2026-07-31, per Ian, live: "hover
// needs just a tick longer... it's a little hard to move slowly down without
// expanding something"), then -> 550ms the same day per his live follow-up
// that Active/Idea specifically still expanded "too quickly."
//
// Exit delay added the same day, per a real bug Ian caught: "I go from
// bottom of ideas to needs attention, it collapses before I can move my
// pointer down there" - even though the pointer never left the card's own
// boundary (already fixed separately, see card's own is-expanded comment).
// Root cause here: nestedList's own base (non-hover) transition had NO
// delay, so the instant the pointer left one section's hover zone en route
// to another, that section's nested list started collapsing (and reflowing
// the layout) immediately - a moving target while Ian was still mid-transit
// toward the next section. Same "hover intent," just for the exit side this
// time, and same pattern already proven for the top-level card/expandWrap
// pair: the delay now lives on nestedList's own base transition (below)
// instead of here, so leaving a section waits before it actually starts
// collapsing, giving real travel time between sibling sections.
// Grid-based reveal (2026-07-31, same fix as expandWrap/detail above) -
// replaces the old max-height: 2000px guess (which existed only to be
// "generous enough to never clip," meaning the transition always ran its full
// duration against mostly-empty space for short lists). Now animates to the
// nested list's real measured height instead.
// Real bug found live (2026-07-31), per Ian: grouped Needs Attention items
// were showing fully expanded, unhidden, the instant Needs Attention itself
// was hovered - not staying collapsed until their OWN group header was
// hovered. Root cause: this rule used a descendant combinator (`.nested`,
// no `>`), which matches ANY .nested element at ANY depth inside the
// hovered wrapper - not just its own direct nested list. That was harmless
// while there was only ONE level of nesting, but now that GroupRow nests a
// SECOND `.nested` list inside NeedsAttention's own `.nested` list (both
// reusing the same literal class name), hovering the outer section matched
// both levels at once, force-expanding every group regardless of whether
// IT was actually being hovered. Fixed with a direct-child combinator
// (`> .nested`) so each level's hover only ever reveals its own immediate
// child list, never a deeper one it doesn't own.
const collapsibleSection = css`
  &:hover > .nested {
    transition-delay: 550ms;
    grid-template-rows: 1fr;
    opacity: 1;
    pointer-events: auto;
    margin-top: 4px;
  }
`

const nestedList = css`
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
  margin-top: 0;
  transition: grid-template-rows 0.4s cubic-bezier(0.16, 1, 0.3, 1) 260ms, opacity 0.3s ease 260ms,
    margin-top 0.4s ease 260ms;
`

const nestedInner = css`
  overflow: hidden;
  min-height: 0;
`

// Expandable children (2026-07-31, per Ian: "would like you to start making
// these all expandable children too"). Reuses `detail`/`detailInner` as-is
// (same grid 0fr->1fr reveal, same visual language as every project row's
// own detail panel) - the only new piece is triggering that reveal here,
// since the original trigger (`&:hover .detail` in `projectItem`'s own css)
// is scoped to a different parent class. Needs Attention rows now carry the
// same rule directly.
const attentionRow = css`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  font-size: 11px;
  line-height: 1.4;
  color: ${NERV_TEXT_DIM};
  padding: 3px 6px;
  animation: fadeIn 0.4s ease;
  border-left: 2px solid transparent;
  transition: background 0.2s ease, border-color 0.2s ease;

  /* Fourteenth-round bump (2026-07-31): Ian tested three hover targets side
     by side and called out "well-being check" (a single, non-grouped
     Needs Attention item, revealed here) as still expanding too quick even
     after the Thirteenth round's 0s -> 260ms fix - meanwhile Active
     (collapsibleSection's 550ms) and Summary (SubField's own 550ms) both
     read as "right amount." Matching those rather than guessing again. */
  &:hover .detail {
    transition-delay: 550ms;
    grid-template-rows: 1fr;
    opacity: 1;
    pointer-events: auto;
    margin-top: 4px;
  }
  &:hover .detailInner {
    padding: 6px 8px;
  }
`

const attentionRowTop = css`
  display: flex;
  align-items: flex-start;
  gap: 6px;
`

const attentionKind = css`
  flex-shrink: 0;
`

// Project grouping (2026-07-31), per Ian: "inside of any subheader like
// active or needs attention, every item connected or part of the same scope
// or project should get linked together into another new subheader that can
// expand." Needs Attention items that share a `` `project-name` `` reference
// (parsed in status_summary.py's parse_needs_ian_items) collapse into their
// own group header, reusing the exact same collapsible/nested mechanism
// already used for the top-level sections - a subheader inside a subheader,
// same pattern one level deeper rather than a new UI concept. `groupCount`
// is a small badge, same idea as sectionHeaderCount's bracketed number but
// lighter-weight to read as a nested level, not a peer of the real sections.
// `groupNestedIndent` pushes the group's own items in slightly further than
// top-level ungrouped items, so the hierarchy (project → its items) reads at
// a glance without needing an explicit tree-line to spell it out.
const groupCount = css`
  color: ${NERV_ORANGE};
  font-weight: 600;
  font-size: 10px;
`

const groupNestedIndent = css`
  padding-left: 10px;
`

// Skills Tray (2026-08-04), per Ian: "i want to visualize and keep track
// of how many skills we have created and get a visual read out of how
// often they are getting run and brief descriptions of what they do."
//
// Rebuilt twice the same day. First version was a small vertical tab
// rendered as a SIBLING of the whole card (needed to escape `card`'s own
// `overflow: hidden`), mounted/unmounted via `{cardExpanded && ...}` with
// its own separate spin-in animation. Ian, live: "skills tray is kind of
// ugly. i dont want it to overlap anything on command space... maybe a
// half circle that perfectly lines up with the top of the big mode bar
// with the first orange line after weekly usage... it needs to expand
// out when small goes to big mode and... needs to collapse at the same
// time it CANNOT linger... it also needs to be completely legible this is
// so small you cant read the text... think of it as an additional modular
// component but essentially functions as and treated as part of big mode
// that expands and collapses at the exact same time."
//
// That last line is the real design instruction, not just flavor text -
// "part of big mode," not a bolted-on extra with its own timing. The
// mount/unmount approach COULDN'T deliver that: React unmounting a node
// has no collapse animation at all (instant gone - the "lingering" Ian
// saw was this component's old DOM node still painted for a frame while
// the card itself had already shrunk back to mini width, since the two
// were never actually synchronized). Fixed at the structural level - see
// `cardOuter`/`cardInner` above: the card split into an unstyled outer
// wrapper (owns `is-expanded`, no overflow clipping) and an inner div that
// kept all the old visual styling (background/clip-path/overflow/sweep).
// Tray is now a permanent CHILD of cardOuter, a sibling of cardInner
// - always in the DOM, never conditionally mounted - so its own
// opacity/transform transition is driven purely by the SAME `is-expanded`
// class the rest of big mode reacts to (see trayBoxStyles's `.is-expanded
// &` rule below), with the exact same easing/duration as `.expand`'s own
// grid transition. One state change, one instant, both animate together -
// there's no separate JS trigger left to desync.
//
// Other changes this round:
//   - Pops out on the LEFT now (Ian: "the half circle is supposed to pop
//     out on the left"), not the right - `trayColumn`'s `left` offset
//     mirrors the math the old right-side version used (flush, zero
//     overlap into the card), and the bump's rounded corners flipped to
//     the left side to match.
//   - Bigger for real legibility (Ian: "this is so small you cant read
//     the text") - 56px x 168px (still a true semicircle: width ==
//     height/2) instead of the old 40x80, with the vertical label bumped
//     to 11px and a little letter-spacing room to breathe.
//   - Vertically flush with the card's own top edge (`top: 0` - see
//     trayColumn's own comment for why this replaced an earlier
//     measured-position version tied to resetsSection's bottom border).
//   - Hover OR click both open the flyout (`&:hover .flyout, &.is-open
//     .flyout` share one rule; click toggles `.is-open` via
//     `toggleTray`).
//   - The flyout cascades straight down and anchors to the RIGHT edge of
//     the handle (mirrored from the old left-side anchor for the
//     right-hand version) - extends further left into open space, never
//     back over the card.
let activeTrayId = null

const toggleTray = (trayId, e) => {
  e.stopPropagation()
  const wrapEl = e.currentTarget.closest(".tray-wrap")
  if (!wrapEl) return
  const opening = activeTrayId !== trayId
  if (activeTrayId && activeTrayId !== trayId) {
    const container = wrapEl.parentElement
    const otherEl = container && container.querySelector(`.tray-wrap[data-tray-id="${activeTrayId}"]`)
    if (otherEl) {
      otherEl.classList.remove("is-open")
      resetHexSelection(otherEl)
    }
  }
  wrapEl.classList.toggle("is-open", opening)
  if (!opening) resetHexSelection(wrapEl)
  activeTrayId = opening ? trayId : null
}

// toggleHexSelection/resetHexSelection (2026-08-04) - per Ian: "when you
// hover over them they are not legible at all they need to overtake the
// skill tray with an overlay... until you click it, or if you leave the
// skill tray it just resets." Replaces the old `&:hover .hex-overlay` CSS
// rule entirely - hover-driven overlays were what produced the illegible,
// half-rendered flicker in his screenshot (the mouse crossing from a tiny
// hex onto its own overlay panel re-triggers hover state mid-transition).
// A click now sets one hex "active" (plain DOM class, same imperative
// pattern as `toggleTray` above - this file has no React state/hooks
// available), clearing any previously active hex first so only one overlay
// is ever showing. Clicking the same hex again toggles it back off.
// Returns whether the tile is open/active AFTER the toggle (2026-08-08,
// Reports Tray v2) - previously returned nothing, since no caller needed
// to know. HexTile's own onClick wrapper (below) uses this to fire
// onTileSelect only on the transition INTO the open state, never on
// close - existing callers of toggleHexSelection (there's only the one,
// HexTile's onClick) never used a return value, so this is a safe,
// backward-compatible addition.
const toggleHexSelection = (e) => {
  e.stopPropagation()
  const cell = e.currentTarget
  const wrapEl = cell.closest(".tray-wrap")
  if (!wrapEl) return false
  const wasActive = cell.classList.contains("is-active")
  wrapEl.querySelectorAll(".hex-cell.is-active").forEach((el) => el.classList.remove("is-active"))
  if (!wasActive) {
    cell.classList.add("is-active")
    // 2026-08-08 fix (final review, Finding 2): the hex overlay is
    // `position: absolute; inset: 0` against `hexWrap` (the whole
    // scrollable grid), not the individual cell - so when a column is
    // taller than `trayListInner`'s 420px scroll viewport, an overlay
    // opened near the bottom of a scrolled column renders its content up
    // at the top of the column, off-screen. Scrolling the containing
    // `.tray-list` back to the top on open keeps the just-opened overlay's
    // content in view. Generic and harmless for Skill Tray/Script Tray
    // too - their own tray-lists are short enough that this is a no-op
    // there. Left alone on the closing path on purpose - no scroll-jump
    // when dismissing a hex.
    const listEl = wrapEl.querySelector(".tray-list")
    if (listEl) listEl.scrollTop = 0
  }
  return !wasActive
}

const resetHexSelection = (wrapEl) => {
  if (!wrapEl) return
  wrapEl.querySelectorAll(".hex-cell.is-active").forEach((el) => el.classList.remove("is-active"))
}

// resetAllTrays (2026-08-04, real bug) - per Ian: "when it sometimes
// goes from mini mode to big mode it still pulls out skills in full tray
// whenever it goes mini mode to big mode, it needs to always start with
// the little tray half circle." Root cause: `activeTrayId` and the
// `.is-open` class it drives are never reset by mini-mode collapse -
// Tray is a permanent DOM child (always rendered, not
// mount/unmount-gated, see its own comment), so if the tray was left open
// when big mode collapsed back to mini, the SAME DOM node - `.is-open`
// class and all - is just what's sitting there hidden, and reappears
// already open the next time big mode expands. Called from `setExpanded`
// below every time the card collapses to mini, so the tray is guaranteed
// to start closed on every fresh expansion, not just the first one.
const resetAllTrays = (cardEl) => {
  if (!cardEl) return
  cardEl.querySelectorAll(".tray-wrap").forEach((wrapEl) => {
    wrapEl.classList.remove("is-open")
    resetHexSelection(wrapEl)
  })
  activeTrayId = null
}

// Rebuilt a third time (2026-08-04) - per Ian, seeing the two-piece
// version live: "so much better!! almost there when highlighted the line
// looks like it goes just a hair above. Also the drop down menu... this
// simply will not do. it needs to be cohesive. the have circle should
// poke out more and the drop down falls directly underneath and in line
// with the pop out circle... it cant just jumble bump out it needs to
// fluid and connected and look good and be intuitive... these were
// jumbled it doesnt match any of that." He also asked for the design term
// for this - the closest established one is Material Design's
// "container transform": a compact affordance expands IN PLACE into the
// larger surface it reveals, sharing an edge/anchor the whole time,
// instead of a separate popover appearing disconnected elsewhere. That's
// what this is now, structurally, not just visually: ONE element, not a
// circular handle plus a separately-positioned flyout box glued together
// after the fact.
//
// The old two-piece version's real bug: the circle was anchored flush to
// the card (`right: 0` on the flyout, matching the handle's own flush
// edge), but the FLYOUT's opposite edge extended much further left than
// the circle's own left edge - so below the circle, the shape suddenly
// got wider only on the far side, with no shared boundary connecting the
// two pieces. Fixed by merging them into `trayBoxStyles`, a single
// element whose `width` AND `left` transition TOGETHER in lockstep
// (`left` always equals `-width`, in both the collapsed and open rules
// below) - the box's RIGHT edge (the one flush against the card) never
// moves, growing only extends the LEFT edge further out. One shape, one
// fixed anchor point, grows in place - literally a container transform.
//
// top: 0, box-sizing: border-box (2026-08-04, revised again) - per Ian:
// "NOW off on alignment when not selected." The previous round's `top: 1px`
// nudge (meant to correct a reported "hair above" gap) evidently
// overcorrected or wasn't the real fix - reverted to the exact, unfudged
// `top: 0` this box's very first placement round established (flush with
// cardInner's own top edge, same y-coordinate as the card itself, no
// guessing). `box-sizing: border-box` added defensively so the 1px border
// is included IN the declared box dimensions rather than added on top of
// them - removes one more place a sub-pixel discrepancy between the
// circle and the card's own border could sneak in.
//
// Entrance unchanged in spirit ("flip out seemingly from behind rotation
// style... can go above that spot but the end static position cannot") -
// `transform-origin: top right` pivots at the fixed corner, rotating from
// folded-up (`rotate(-90deg)`) down to resting (`rotate(0deg)`).
// Visibility still driven by the ancestor `.is-expanded` class (`.is-expanded
// &`, same stylis ancestor-nesting trick as `.detail`/`.nested` elsewhere)
// so the tray's enter/exit rides the exact same state change and timing
// as the rest of big mode - unchanged from the previous round, see that
// history for the full reasoning.
const trayBoxStyles = (accentColor) => css`
  z-index: 5;
  width: 84px;
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: ${NERV_BG};
  border: 1px solid ${NERV_LINE};
  border-right: none;
  border-radius: 999px 0 0 999px;
  overflow: hidden;
  cursor: pointer;
  opacity: 0;
  transform: rotate(-90deg);
  pointer-events: none;
  transform-origin: top right;
  box-shadow: none;
  transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 280ms,
    transform 0.5s cubic-bezier(0.16, 1, 0.3, 1) 280ms, width 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    border-radius 0.4s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.25s ease, box-shadow 0.25s ease;

  .is-expanded & {
    opacity: 1;
    transform: rotate(0deg);
    pointer-events: auto;
    transition-delay: 0s;
  }

  /* Grow IN PLACE (2026-08-04) - width changes, right edge stays put.
     Originally this rule owned both width AND left together (one shared
     anchor, one continuous shape, instead of two pieces with independent
     positioning math that could and did drift apart); as of Task 5, the
     "right edge stays put" half of that job moved up to the shared
     trayColumn wrapper (align-items: flex-end, position: absolute; right:
     100% on trayColumn itself) so a second tray box can stack under this
     one without each box re-deriving its own fixed-right-edge math. This
     rule now only owns width/shape - no position/top/left of its own.
     Background is NOT changed here (2026-08-04, real regression fixed) -
     per Ian: "clear tool bar here is no good." The first merged version
     swapped the solid NERV_BG panel for a near-transparent orange tint on
     hover/open, which is what actually read as "clear"/washed-out - a
     real panel needs to stay a solid, opaque surface once it's holding
     real readable content, not fade toward see-through the moment it
     opens. Background stays the same solid NERV_BG in both states now;
     only the border brightens to orange and a box-shadow (same weight
     the old flyout inner box used before the merge) gives it real depth
     as a floating panel.

     CLICK-ONLY now, no more hover-triggered open (2026-08-04, real bug) -
     per Ian: "bug when skill tray is kinda sticky when it shouldnt. if u
     click skill tray it should switch just between big mode and small
     mode." The old rule opened on BOTH hover and the is-open class -
     clicking while already hovering set is-open true on top of the hover
     state, and once the mouse then left, hover ended but is-open (set by
     the click) was still true, so the box stayed stuck open with no
     hover left to explain why. One trigger only now: toggleTray's
     is-open class, nothing else opens or closes this box. */
  &.is-open {
    width: 272px;
    border-radius: 10px 0 0 10px;
    /* border-color intentionally NOT bumped to full-opacity NERV_ORANGE
       here anymore (2026-08-04) - per Ian: "outter lines of big mode
       skill tray are too thick." Same 1px width the whole time; what
       actually read as "thick" was the jump from NERV_LINE's translucent
       35% orange (the same weight every other border in this file uses -
       card's own included) to a fully-opaque, saturated orange, which
       reads visually heavier at identical pixel width. Left at NERV_LINE
       now; the box-shadow alone signals "open." */
    box-shadow: 0 4px 28px rgba(0, 0, 0, 0.5);
  }

  /* Hazard-stripe texture, re-themed red (2026-08-04) - per Ian, sharing
     an Evangelion MAGI-terminal reference screenshot, then later: "match
     the theming here as much as possible" against a second reference
     showing the MAGI hex grid in red/black. First version kept this
     stripe orange (matching the rest of the widget's palette) - Ian then
     asked the tray's INTERIOR specifically to go red ("i dont like this
     orange for skill tray... interior objects and stuff here should be
     red"), keeping only the outer border + black background on the
     established orange/black scheme. Uses color-mix against STATUS_RED
     instead of a hand-picked rgba so this tracks the theme file if that
     color ever changes. */
  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: repeating-linear-gradient(
      45deg,
      color-mix(in srgb, ${accentColor} 8%, transparent) 0px,
      color-mix(in srgb, ${accentColor} 8%, transparent) 5px,
      transparent 5px,
      transparent 11px
    );
    pointer-events: none;
  }

  &.is-open .tray-list {
    transition-delay: 120ms;
    grid-template-rows: 1fr;
    opacity: 1;
    pointer-events: auto;
  }
`

// trayColumn (Task 5) - shared wrapper for every tray box (Skill Tray,
// Script Tray, and whatever comes after), now the sole owner of the
// "flush against the card's left edge, growing leftward" positioning
// that used to live on each trayBoxStyles box individually via its own
// `left: -width`. `right: 100%` anchors the column's own right edge to
// cardOuter's left edge (cardOuter is `position: relative`, and this is
// a direct child of it, same relationship trayBoxStyles used to have on
// its own); `align-items: flex-end` then keeps every tray box's right
// edge flush with the column's right edge regardless of that box's own
// width, so a narrow closed pill and a wide open panel still line up on
// the same edge without either one needing its own left/right math.
// `flex-direction: column` + `gap` is what makes a second tray
// automatically stack below the first instead of needing its own
// absolute top offset.
// Sibling-hide (2026-08-06), per Ian's screenshot feedback: an inactive
// tray's own collapsed pill used to keep rendering directly below an OPEN
// sibling panel - visually disconnected, "hanging" in empty space below
// the open panel's own bottom edge instead of reading as part of the same
// control. Now: whenever trayColumn contains any `.is-open` tray, every
// OTHER tray hides itself (opacity + pointer-events, same pattern the
// hazard-stripe/mini-mode reveal already uses elsewhere in this file, not
// a new idiom) until the open one collapses back down. `:has()` keeps this
// declarative and CSS-only - no new JS state needed, `.is-open` is already
// the real source of truth `toggleTray` maintains. Specificity note: this
// selector (1 class + :has(2 classes) + 1 class + :not(1 class) = 5
// classes) correctly outranks `trayBoxStyles`'s own `.is-expanded &` rule
// (2 classes) without `!important`, and reuses that same rule's already-
// declared `opacity`/`transition` properties rather than redeclaring them.
// Gap dropped from 8px to 0 (Ian: "they can also be right up next to each
// other") - the two collapsed pills now sit flush when neither is open.
const trayColumn = css`
  position: absolute;
  top: 0;
  right: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0;
  pointer-events: none;

  &:has(.tray-wrap.is-open) .tray-wrap:not(.is-open) {
    opacity: 0;
    pointer-events: none;
  }
`

// Content-hugging height now, not a fixed 168px (2026-08-04, real bug) -
// per Ian, seeing the open panel live: "so much empty space here at the
// top." The 168px figure was sized back when the label ran vertically
// (rotated sideways down the collapsed pill's long edge) and needed that
// much room; once the label went horizontal (see trayLabel's own
// comment), this zone only ever holds two short lines of text, so the
// leftover fixed height was just dead air above the hex grid every time
// the tray opened. Padding-driven height instead - shrinks the open
// panel's header to what the count+label actually need, and as a side
// effect makes the COLLAPSED pill shorter and closer to circular, which
// is arguably closer to the tray's own original "half circle" pitch than
// the tall capsule this had drifted into.
const trayHandleZone = css`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 14px 6px;
`

// Horizontal now, not rotated (2026-08-04) - per Ian: "skill tray should
// be horizontal when in big mode." Wraps across two lines ("SKILL"/"TRAY")
// inside the collapsed 84px-wide handle zone instead of running sideways
// - normal reading orientation is more legible than rotated text was
// (the original complaint that got this whole tray resized bigger in the
// first place), and it doesn't require relocating the tray itself off the
// left edge, which would reopen the overlap/placement problems already
// solved for that position.
const trayLabel = css`
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: center;
  color: ${NERV_TEXT_DIM};
`

// Red now, not orange (2026-08-04) - per Ian: "match the theming here as
// much as possible" against the MAGI red/black hex reference, and
// separately "interior objects and stuff here should be red" - the tray's
// own border + black background stay on the widget's established
// orange/black scheme (that's the part Ian said "we have worked"), but
// every accent INSIDE the tray switches to STATUS_RED.
const trayCountStyles = (accentColor) => css`
  font-size: 12px;
  font-weight: 700;
  color: ${accentColor};
`

// Cascades DOWN below the header zone, same grid 0fr->1fr reveal language
// as every other expandable list in this file (see `nestedList`/`detail`) -
// `tray-list` is a plain literal class (same trick as `.detail`/`.nested`)
// so `trayBoxStyles`'s own `:hover .tray-list, .is-open .tray-list` rule
// can target it. No separate positioning of its own anymore - it's just
// the second child in `trayBoxStyles`'s flex column, sharing the box's
// background/border/width automatically since it's part of the same
// element now.
const trayListGrid = css`
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  pointer-events: none;
  transition: grid-template-rows 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
`

const trayListInner = css`
  overflow: hidden;
  min-height: 0;
  max-height: 420px;
  overflow-y: auto;
  padding: 0 10px 10px 10px;

  &::-webkit-scrollbar {
    width: 5px;
  }
  &::-webkit-scrollbar-thumb {
    background: ${NERV_LINE};
    border-radius: 2px;
  }
`

const skillRowName = css`
  color: ${NERV_TEXT};
  font-weight: 600;
`

const formatSkillLastUsed = (hoursAgo) => {
  if (hoursAgo == null) return "never run"
  if (hoursAgo < 1) return "used <1h ago"
  if (hoursAgo < 24) return `used ${Math.round(hoursAgo)}h ago`
  return `used ${Math.round(hoursAgo / 24)}d ago`
}

// formatUpdatedRecency (2026-08-05) - per Ian: "provide... latest update"
// as one of the overlay's little-header sections. Mirrors
// formatSkillLastUsed's own age-bucketing (mirrors how humans actually
// talk about recency: hours/days) but reads from SKILL.md's own mtime
// (`updated_hours_ago`, see status_summary.py) rather than the usage log -
// "updated" and "used" are genuinely different facts about a skill.
const formatUpdatedRecency = (hoursAgo) => {
  if (hoursAgo == null) return "unknown"
  if (hoursAgo < 1) return "<1h ago"
  if (hoursAgo < 24) return `${Math.round(hoursAgo)}h ago`
  return `${Math.round(hoursAgo / 24)}d ago`
}

// formatSkillCounts (2026-08-04) - per Ian: "we need to make sure these
// are all distinguished [manual vs auto-executed]." A single undifferentiated
// number used to hide whether a skill's calls came from Ian asking
// directly or from a scheduled task/another skill invoking it - this
// spells both out when either is present, e.g. "2 manual · 1 auto",
// falling back to just whichever one is non-zero if only one kind has
// happened yet.
const formatSkillCounts = (skill) => {
  const { manual_count: manual = 0, auto_count: auto = 0 } = skill
  if (manual === 0 && auto === 0) return ""
  if (manual > 0 && auto > 0) return `${manual} manual · ${auto} auto · `
  if (auto > 0) return `${auto} auto · `
  return `${manual} manual · `
}

// skillOverlaySection / overlayLabelStyles (2026-08-05) - per Ian: "we can
// provide summary, number of times used, if its used by other skills,
// latest update and these can have little headers... this doesnt need to
// be expandable." Same visual shape as `detailLabel` (uppercase, small,
// letter-spaced little-header look already established elsewhere in this
// file) but colored to match the owning tray's own accent instead of
// NERV_ORANGE - STATUS_RED for the Skill Tray's own NGE-red theme rather
// than the rest of the widget's amber - and, deliberately, no click/expand
// behavior at all: these are always-visible static blocks, not another
// SubField.
// Turned into an `(accentColor) => css\`...\`` factory (Task 5 final
// review fix, same pattern as `trayCountStyles`/`hexOutlineStyles`
// elsewhere in this file) - was still hardcoding STATUS_RED even after the
// Script Tray (blue) started reusing this same label for its own overlay
// rows, which rendered its "Project"/"Path"/"Summary"/"Last updated"
// labels red instead of blue. `HexTile` already passes `accentColor` as a
// second argument into `renderOverlayBody(item, accentColor)`; the two
// render functions below now accept and thread it through.
const overlayLabelStyles = (accentColor) => css`
  color: ${accentColor};
  text-transform: uppercase;
  font-size: 9px;
  letter-spacing: 0.08em;
`

const skillOverlaySection = css`
  margin-top: 8px;
  &:first-of-type {
    margin-top: 6px;
  }
`

const skillOverlayBody = css`
  font-size: 11px;
  line-height: 1.5;
  color: ${NERV_TEXT};
  margin-top: 2px;
`

// Reports Tray hex-overlay bullet styles (2026-08-07) - kept from the
// original panel-based port (2026-08-06) when the tray was rebuilt as hex
// tiles matching Skill/Script Tray's own format, per Ian: "sorry needs to
// be hex format like the others." These two list-item treatments (dash
// bullet vs "!" attention bullet) are genuinely distinct from the shared
// skillOverlayBody/skillOverlaySection styles the hex overlay otherwise
// reuses, so they're kept rather than folded away. Everything else from
// the panel-based version (the always-visible three-panel layout, its own
// header/meta/empty-state styles) is gone - see renderReportOverlayBody
// and reportsItems below for what replaced it.
const reportsBulletList = css`
  margin: 0;
  padding: 0;
  list-style: none;
`

const reportsBulletItem = css`
  font-size: 11px;
  line-height: 1.4;
  color: ${NERV_TEXT};
  margin-bottom: 4px;
  padding-left: 10px;
  position: relative;

  &::before {
    content: "–";
    position: absolute;
    left: 0;
    color: ${NERV_TEXT_DIM};
  }

  &:last-child {
    margin-bottom: 0;
  }
`

const reportsAttentionBulletItem = css`
  font-size: 11px;
  line-height: 1.4;
  color: ${NERV_TEXT};
  margin-bottom: 4px;
  padding-left: 12px;
  position: relative;

  &::before {
    content: "!";
    position: absolute;
    left: 0;
    color: ${NERV_ORANGE};
    font-weight: 700;
  }

  &:last-child {
    margin-bottom: 0;
  }
`

const reportsMoreNote = css`
  font-size: 9px;
  color: ${NERV_TEXT_DIM};
  margin-top: 3px;
`

// Hex grid (2026-08-04), replaced the plain row list, then reworked again
// the same day - per Ian, sharing two MAGI-terminal reference images:
// first "could skills populate in big mode like this with the hexagonal
// pattern... hovering over them makes the skill summary and info readout
// overlay on the big mode readout of just the skill tray," then live
// feedback on that first pass plus a second reference image of a true
// edge-to-edge red/black hex grid: "look at all the space for the
// hexagones they should be right next to each other with thick borders
// between them... match the theming here as much as possible."
//
// FLAT-TOP orientation (2026-08-04, real reorientation, not just styling) -
// per Ian, looking at the live pointy-top version next to the same
// reference image again: "it should be flat at the top the hexagons need
// to be rotated." Pointy-top hexagons (a vertex at top-center/bottom-
// center) is what every earlier round of this section built - flat-top
// (a flat horizontal edge at top/bottom, vertices at left-center/right-
// center) is a 90-degree reorientation, not a small tweak, and it flips
// which axis tiles by touching-edges vs. offset-rows:
//   - Flat-top hexagons have a flat TOP/BOTTOM edge, so they tile cleanly
//     stacked in COLUMNS (vertically, edge-to-edge, zero gap) - the exact
//     role the old pointy-top ROWS played. `hexColumn` replaces
//     `skillHexRow`; `hexGrid` is now `flex-direction: row` (laying
//     columns out left-to-right) instead of `column`.
//   - Alternate COLUMNS get the offset now (`margin-top: HEX_H / 2` on
//     even columns), not alternate rows - the honeycomb interlock axis
//     rotates with the hexagon.
//   - Column-to-column horizontal step is `HEX_W * 0.75` (via
//     `margin-left: -(HEX_W * 0.25)` on every column but the first) - the
//     same "asymmetric hexagon" math as before, just swapped from the
//     vertical axis to the horizontal one.
//   - `box-sizing: border-box` on the tile (2026-08-04, real bug from the
//     original pointy-top build) - carried forward unchanged; still
//     matters here for the same reason (border must be INSIDE the
//     declared box, not added on top of it, or the spacing math above
//     drifts by a couple px per hex).
//   - Each hex keeps its own full border; two touching hexes' borders sit
//     right next to each other, reading as one thicker shared line - the
//     "thick borders between them" Ian asked for, not a separate seam
//     hack.
//
// Used/never-run now reads as FILLED vs OUTLINE, not just a dim vs. bright
// count (2026-08-04, matching the reference image's checker of solid-red
// and black-outlined cells) - a skill that's been called is a solid red
// hex with dark text; one that's never run stays black with a red outline
// and red text. Same real `call_count` data as before - the reference
// image just gave the existing used/never-run distinction a far more
// legible visual home than a small colored number did.
//
// Selection is click-driven now, not hover (2026-08-04, real bug) - per
// Ian: "when you hover over them they are not legible at all... until you
// click it, or if you leave the skill tray it just resets." The old
// `&:hover .hex-overlay` rule is what produced the illegible, half-
// rendered flicker in his screenshot (crossing from a tiny hex onto its
// own overlay re-triggers hover state mid-transition). `toggleHexSelection`
// (defined up near `toggleTray`) sets one hex `.is-active` via a
// plain click handler. Leaving the tray entirely calls
// `resetHexSelection` (wired into `Tray`'s own `onMouseLeave`,
// alongside the existing `armCollapse` call) so nothing stays pinned open
// once the mouse is gone.
//
// `hexCell`/`hexOutlineStyles` split (2026-08-04, second real bug found
// live, same round as the click-selection fix above) - clicking a hex DID
// select it, but the overlay rendered illegible and half-hidden behind
// LATER hexes in the grid. Root cause: `clip-path` (on `hexOutlineStyles`)
// establishes its own CSS stacking context, same as `opacity`/`transform`/
// `filter` do - so nesting the overlay INSIDE the clipped tile scoped its
// `z-index: 30` to that one tile's own local context, not the tray as a
// whole. Every OTHER hex tile (each also `clip-path`-isolated) still
// painted in normal DOM order on top of it, since z-index only wins
// battles within a shared stacking context - hexes from later rows won
// that fight and covered the overlay's text. Fixed by splitting each
// hex into an unclipped `hexCell` wrapper (plain, no clip-path, no
// stacking context of its own) holding two SIBLINGS: the visual
// `hexOutlineStyles` (still clipped, still what's visibly clicked) and the
// overlay - since the overlay is no longer a DESCENDANT of anything
// clip-path'd, it isn't trapped in a local stacking context and its
// `z-index: 30` finally competes at `hexWrap`'s level, correctly
// painting over every hex regardless of row. `.is-active` now toggles on
// the cell (via `toggleHexSelection`), not the tile, so the CSS descendant
// selector (`&.is-active .hex-overlay`) still reaches the overlay.
//
// `hexWrap` still carries `position: relative` for the SAME layout
// reason as before - `hexOverlayStyles` is `position: absolute; inset: 0`
// and `hexCell` is deliberately left `static` (unpositioned), so the
// overlay skips past it and binds to this wrap instead, covering the
// whole grid rather than just its own cell.
//
// This is also the pre-planned slot system Ian asked for ("preplan a grid
// layout system for skills to slot in when we add more, it should be easy
// to add a new skill into the next one") - `chunkIntoColumns` just
// walks the skills list in fixed-size chunks of `SKILL_HEX_COL_SIZE`; a
// new skill added to the catalog automatically lands in the next open
// slot (or starts a new column) with no per-skill layout code anywhere in
// this file.
// Flat-top ratio (2026-08-04, swapped from the old pointy-top 66x76) -
// width is now the LONGER dimension (a regular flat-top hexagon has
// width = height * 2/sqrt(3), the inverse of pointy-top's ratio), so W/H
// swap along with the shape itself.
// Sized up twice now (2026-08-05): 78x68 -> 90x78, per Ian: "can we size
// up the size of all the hexagons a little bit," then -> 94x82, per his
// direct follow-up: "maybe just a little bigger for the sake of size and
// eating up some empty space without needing to scroll or go outside the
// boundaries yet." Pushed close to the real ceiling this time rather than
// another small bump - tray's available row width is ~242px
// (trayBoxStyles's 272px open width, minus tray-list's 20px and
// hexWrap's 8px of horizontal padding); 3 columns at this size take
// 94 + 2 * (94 * 0.75) = 235px, about as large as fits with a small
// margin before actually needing to widen the tray box itself (that's
// the "yet" in Ian's own phrasing - a real next step if he wants bigger
// still, not attempted here).
// SKILLS_TRAY_HEX_ROW_MAX_WIDTH (2026-08-05) - per Ian, after a screenshot
// caught the hex grid's 4th column bleeding straight past the tray's own
// right edge into the widget next to it: "can we make a check for styling
// to make sure that never happens or is avoided?" This is the single
// source of truth for "how wide can one row of hexes actually get before
// it blows past `trayBoxStyles`'s real boundary" - `trayBoxStyles`'s own
// `.is-open` width (272px) minus `trayListInner`'s horizontal
// padding (10px each side) minus `hexWrap`'s own (4px each side) =
// 244px; kept at a clean 242px to leave a couple px of real margin rather
// than computing to the exact pixel. `scripts/verify_widget.sh` reads
// this same constant (along with `HEX_W`/`SKILL_HEX_COLUMNS` below) and
// fails the check if the flat-top tiling formula (`HEX_W * (1 + 0.75 *
// (columns - 1))`, the same math `SKILL_HEX_COLUMNS`'s own comment uses)
// ever computes a row wider than this - so changing either constant
// without checking the other now fails loud in the same place every other
// live-parity check already lives, instead of only showing up as clipped
// hexes in a screenshot days later.
const SKILLS_TRAY_HEX_ROW_MAX_WIDTH = 242
const HEX_W = 94
const HEX_H = 82
// FIXED column count, growth now goes DOWN not RIGHT (2026-08-05, real
// bug found live via screenshot) - per Ian: "wrong spot to add... if we
// build out to ~4ish staggered hexagons wide, the size of the hexagons
// should be decreased. additionally if thats the case, lets first see
// what that looks like and rearrange them so new hex's get added to the
// bottom... and then we will scroll as it gets built out."
//
// This used to be `SKILL_HEX_COL_SIZE = 3` - "3 skills per column," with
// `chunkIntoColumns` opening a brand-new COLUMN every time a 4th
// skill needed a home. That's exactly what the screenshot caught: 10
// skills produced 4 columns (3+3+3+1), and `hexGrid` (`flex-direction:
// row`, no wrap, no width cap) just kept extending the grid rightward with
// each new column - straight past `trayBoxStyles`'s own fixed 272px open
// width, with the 4th column's hexes (`tutor`, `log-rollup`) visibly
// clipped by the panel's real edge in Ian's screenshot. The tray's
// vertical scroll (`trayListInner`'s `max-height: 420px;
// overflow-y: auto`, which the whole hex grid already renders inside of)
// was sitting right there unused the entire time - the grid was growing
// in the one axis that ISN'T scrollable instead of the one that is.
//
// Fix: `SKILL_HEX_COLUMNS` is now the column COUNT (fixed at 3, matching
// the width Ian already approved and tuned this hex size against - see
// the sizing comment above), not a per-column skill limit. New skills
// round-robin into whichever column comes next (`i % SKILL_HEX_COLUMNS`)
// instead of opening a new column - so the grid's WIDTH never changes as
// skills are added, only each column's HEIGHT does, which is exactly "new
// hexes get added to the bottom" and lands inside the scroll container
// that already exists for it. Going to 4 columns wide (Ian's other ask,
// still open) is a real, deliberate widening + hex-size-down decision to
// make separately, not something that should ever happen as a silent
// side effect of the skill count crossing a multiple of 3 again.
const SKILL_HEX_COLUMNS = 3
// Solid near-black for text ON a filled red hex (2026-08-04) - NERV_BG
// itself is translucent (`rgba(10, 9, 8, 0.92)`), fine for a background
// layered over the card, but not for text that needs to read as opaque
// dark-on-red regardless of what's underneath.
const HEX_FILL_TEXT = "#0a0908"

// groupKey (2026-08-09, Reports Tray v2 fix-round) - optional second
// param, undefined for every existing caller (Skill Tray/Script Tray),
// so the `if (!groupKey)` branch below is byte-identical to this
// function's previous unconditional body and those two trays are
// completely unaffected. When passed (Reports Tray, keyed by
// `item.reportSource`), each distinct group claims its own column in
// first-seen order instead of round-robining by flat index - the flat
// `i % SKILL_HEX_COLUMNS` scheme scattered a source's own multi-instance
// backlog across different columns, breaking the "oldest unread stacks
// at the top of its own column" behavior Reports Tray needs.
// serpentine (2026-08-10) - third optional fill mode, added for Reports
// Tray v2 per Ian: "i dont think we need columns organized by their log
// they can just be arranged in serpentine fashion in this general
// chronological order... the row of read reports going from left to
// right and then down in reverse." Replaces Reports Tray's own use of
// `groupKey` (still here, still used by nothing today, but not deleted -
// the per-source grouping it did is a real, working capability that may
// be wanted again) - `groupKey` topped out at exactly SKILL_HEX_COLUMNS
// (3) distinct groups before two sources would start sharing a column,
// which the final review on the read/unread branch flagged as a real
// blocker for Plan B's full 7-source vision. `serpentine` has no such
// ceiling: it's pure row-major boustrophedon fill over `items`' own
// order (the caller is responsible for chronological sorting - see
// reportsItems) - row 0 fills columns left-to-right, row 1 fills
// right-to-left, row 2 left-to-right again, and so on, growing downward
// with no limit on how many rows accumulate. Reading top-to-bottom
// through all three columns together traces one continuous chronological
// zig-zag, which is the actual ask - not "each column is its own zig-zag"
// (that would be a different, more confusing pattern for a reader's eye
// to follow across three separate columns at once).
const chunkIntoColumns = (items, groupKey, serpentine) => {
  const columns = Array.from({ length: SKILL_HEX_COLUMNS }, () => [])
  if (serpentine) {
    items.forEach((item, i) => {
      const row = Math.floor(i / SKILL_HEX_COLUMNS)
      const posInRow = i % SKILL_HEX_COLUMNS
      const col = row % 2 === 0 ? posInRow : SKILL_HEX_COLUMNS - 1 - posInRow
      columns[col].push(item)
    })
    return columns
  }
  if (!groupKey) {
    items.forEach((item, i) => columns[i % SKILL_HEX_COLUMNS].push(item))
    return columns
  }
  const groupToColumn = {}
  let nextColumn = 0
  items.forEach((item) => {
    const key = groupKey(item)
    if (!(key in groupToColumn)) {
      groupToColumn[key] = nextColumn % SKILL_HEX_COLUMNS
      nextColumn += 1
    }
    columns[groupToColumn[key]].push(item)
  })
  return columns
}

// Solid rectangular background REMOVED again (2026-08-04) - per Ian,
// looking at the now-tightly-tiled flat-top grid: "remove back square
// background here." It was added in an earlier round to stop the
// hazard-stripe texture from bleeding through the small gaps between
// hexes (see the two-layer outline/fill work above) - but with hexes now
// touching edge-to-edge and mostly filled solid, that solid rectangle
// itself became the more visible problem: a flat, untextured square
// sitting behind the hex cluster with its own visible edge where it met
// the tray's textured background. Dropped - the little texture that
// shows through the tiling's own tiny corner gaps now is far less area
// than the visible rectangle seam was.
const hexWrap = css`
  position: relative;
  padding: 2px 4px 10px 4px;
`

// `flex-direction: row` now (2026-08-04, was `column`) - the grid lays
// COLUMNS out left-to-right; each column itself stacks its hexes
// top-to-bottom. See the flat-top reorientation comment above for why the
// row/column roles swapped along with the hexagon shape.
// justify-content: center added (2026-08-04) - per Ian: "can u get it
// centered more in the tab." The grid's actual content width (three
// overlapping columns) is narrower than the tray's available width, and
// with no justify-content set the row defaulted to flex-start, packing
// everything against the left edge instead of centering in the space it
// actually has.
const hexGrid = css`
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: center;
`

const hexColumn = css`
  display: flex;
  flex-direction: column;
  gap: 0;

  &:nth-of-type(even) {
    margin-top: ${HEX_H / 2}px;
  }
  &:not(:first-of-type) {
    margin-left: ${-(HEX_W * 0.25)}px;
  }
`

// Unclipped wrapper (2026-08-04) - see the big comment above for why this
// split exists. Deliberately no `clip-path`, `transform`, `opacity`,
// `filter`, or `position` here - any of those would re-create the same
// stacking-context trap this split exists to avoid, or (for `position`)
// would make this cell itself the overlay's containing block instead of
// letting it skip through to `hexWrap`.
const hexCell = css`
  width: ${HEX_W}px;
  height: ${HEX_H}px;
  flex-shrink: 0;
  cursor: pointer;

  &.is-active .hex-overlay {
    opacity: 1;
    pointer-events: auto;
  }
`

// Two-layer outline/fill split (2026-08-04, real bug found live) - per
// Ian: "can the hex have slight red outline" - looking at the last
// screenshot, only the flat top/bottom edges of each unfilled hex showed
// any visible border at all; the four slanted edges were essentially
// invisible. Root cause: `border` + `clip-path` on the SAME element is a
// known CSS trap - the browser paints the border first as part of the
// box, THEN clips the whole result (fill AND border) to the polygon. On
// the flat top/bottom edges the polygon line exactly coincides with the
// box's own edge, so the full border survives; everywhere else (every
// slanted edge) the polygon cuts diagonally straight through the middle
// of the border's own stroke width, leaving only a sliver - thin enough
// at 1px that it reads as gone. `border` never actually gives a clean
// outline on a clip-path'd shape at this scale.
//
// Fixed with two stacked, independently clipped layers instead of a
// border at all: `hexOutlineStyles` (this cell's direct child) is a solid
// STATUS_RED hexagon at full size; `hexFill` sits inset a couple px
// on every side, clipped to the SAME polygon (percentages recompute
// automatically for the smaller box), and holds the real fill color -
// STATUS_RED again for a used skill (reads as fully solid, exactly like
// the reference's solid cells, since outline and fill match), or NERV_BG
// for a never-run one (the red outer layer shows through as a crisp,
// uniform ring all the way around - the actual "slight red outline" Ian
// asked for, working on every edge, not just the flat ones).
const hexOutlineStyles = (accentColor) => css`
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
  background: ${accentColor};
  position: relative;

  .hex-cell:hover & {
    background: ${NERV_TEXT};
  }
`

const HEX_OUTLINE_WIDTH = 2

const hexFill = css`
  position: absolute;
  inset: ${HEX_OUTLINE_WIDTH}px;
  clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 0 4px;
  transition: background 0.2s ease;
`

// Triangle glyphs replacing the plain call-count digit (2026-08-04) - per
// Ian, pointing directly at the MAGI reference image's own hex content:
// "i want it to look like this." That image flanks each cell's label with
// a solid up-triangle above and down-triangle below, not a number - real
// call-count data still lives one click away in the overlay
// (`formatSkillCounts`), this is purely the tile FACE now matching that
// specific visual language instead of a half-borrowed version of it.
const hexTriangle = css`
  font-size: 9px;
  line-height: 1;
  flex-shrink: 0;
`

// Wraps onto multiple lines now instead of truncating with an ellipsis
// (2026-08-04, real bug) - per Ian: "have full displaced skill text if it
// needs new line in the hex no overlap." A flat-top hex has full usable
// width across its vertical middle, and the vertical stack here (two
// triangles + this label) only uses roughly half the hex's own height
// even at 3 wrapped lines, so there was always room for the FULL name -
// `white-space: nowrap` + `text-overflow: ellipsis` was cutting names
// short for no real space reason. `-webkit-line-clamp: 3` caps it at
// three wrapped lines (with its own ellipsis as a last-resort safety net,
// not the normal case) so a pathologically long future skill name still
// can't overflow the hex and overlap its neighbors - "no overlap," same
// as asked, just handled by capping instead of truncating on line one.
const hexLabel = css`
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-align: center;
  line-height: 1.2;
  max-width: 50px;
  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
`

// hexSubtitle (2026-08-10) - optional small second line under a hex's main
// label, per Ian's screenshot feedback on Reports Tray: with several
// stacked instances of the same source (e.g. five IANLOGGER hexes), the
// face alone couldn't tell them apart without opening each one. Generic
// on HexTile (below), not Reports-specific - Skill Tray/Script Tray items
// never set `item.subtitle`, so nothing renders there and nothing about
// their face changes.
const hexSubtitle = css`
  font-size: 8px;
  font-weight: 500;
  letter-spacing: 0.02em;
  opacity: 0.75;
  margin-top: 1px;
`

const hexOverlayStyles = (accentColor) => css`
  position: absolute;
  inset: 0;
  z-index: 30;
  background: ${NERV_BG};
  border: 1px solid ${accentColor};
  padding: 10px;
  overflow-y: auto;
  text-align: left;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, ${accentColor} 35%, transparent);
    border-radius: 2px;
  }
`

// renderSkillOverlayBody extracted from the old skill-only hex tile
// component (this task) so the overlay CONTENT stays skill-specific while
// the tile mechanics around it (HexTile below) become fully generic - a
// second tray (scripts, Task 5) reuses HexTile/HexGrid with its own
// overlay-body renderer instead of this one.
const renderSkillOverlayBody = (skill, accentColor) => (
  <div>
    <div className={skillRowName} style={{ fontSize: 13 }}>{skill.name}</div>

    {skill.description && (
      <div className={skillOverlaySection}>
        <div className={overlayLabelStyles(accentColor)}>Summary</div>
        <div className={skillOverlayBody}>{skill.description}</div>
      </div>
    )}

    <div className={skillOverlaySection}>
      <div className={overlayLabelStyles(accentColor)}>Used</div>
      <div className={skillOverlayBody} style={{ whiteSpace: "normal" }}>
        {formatSkillCounts(skill)}
        {formatSkillLastUsed(skill.last_called_hours_ago)}
      </div>
    </div>

    {skill.called_by && skill.called_by.length > 0 && (
      <div className={skillOverlaySection}>
        <div className={overlayLabelStyles(accentColor)}>Called by</div>
        <div className={skillOverlayBody}>{skill.called_by.join(", ")}</div>
      </div>
    )}

    {skill.calls && skill.calls.length > 0 && (
      <div className={skillOverlaySection}>
        <div className={overlayLabelStyles(accentColor)}>Calls</div>
        <div className={skillOverlayBody}>{skill.calls.join(", ")}</div>
      </div>
    )}

    <div className={skillOverlaySection}>
      <div className={overlayLabelStyles(accentColor)}>Last updated</div>
      <div className={skillOverlayBody}>{formatUpdatedRecency(skill.updated_hours_ago)}</div>
    </div>
  </div>
)

// renderScriptOverlayBody (Task 5) - the Script Tray's own overlay-body
// renderer, passed to the same generic HexGrid/HexTile the Skill Tray
// uses. Reuses skillRowName/skillOverlaySection/overlayLabelStyles/
// skillOverlayBody as-is (same little-header layout, no script-specific
// variant needed) - only the fields shown differ from
// renderSkillOverlayBody: script/project/path/summary/last-updated
// instead of skill/summary/used/called-by/calls/last-updated, matching
// what load_scripts_catalog (Task 1) actually puts on each script entry.
const renderScriptOverlayBody = (script, accentColor) => (
  <div>
    <div className={skillRowName} style={{ fontSize: 13 }}>{script.name}</div>

    <div className={skillOverlaySection}>
      <div className={overlayLabelStyles(accentColor)}>Project</div>
      <div className={skillOverlayBody}>{script.project}</div>
    </div>

    <div className={skillOverlaySection}>
      <div className={overlayLabelStyles(accentColor)}>Path</div>
      <div className={skillOverlayBody}>{script.path}</div>
    </div>

    {script.description && (
      <div className={skillOverlaySection}>
        <div className={overlayLabelStyles(accentColor)}>Summary</div>
        <div className={skillOverlayBody}>{script.description}</div>
      </div>
    )}

    <div className={skillOverlaySection}>
      <div className={overlayLabelStyles(accentColor)}>Last updated</div>
      <div className={skillOverlayBody}>{formatUpdatedRecency(script.updated_hours_ago)}</div>
    </div>
  </div>
)

// HexTile/HexGrid (this task) - generalized from the old skill-only hex
// tile/grid pair so a second tray (scripts, Task 5) can reuse the same
// tile mechanics with its own accent color and overlay content, not just
// the skill tray. Same two-layer outline/fill split and unclipped-cell/
// overlay-sibling structure as before (see the big comment above for why
// both of those exist) - just parameterized on `accentColor` instead of
// hardcoding STATUS_RED, and taking `renderOverlayBody` instead of
// hardcoding the skill-specific overlay markup.
// onTileSelect (2026-08-08, Reports Tray v2) - optional, defaults to
// undefined so Skill Tray/Script Tray's existing call sites (which don't
// pass it) are completely unaffected. Fires only when a tile transitions
// INTO the open state (per toggleHexSelection's own new return value),
// never on close - Reports Tray uses this to mark a hex read the moment
// its overlay is actually opened, matching how notification-style UIs
// typically clear on open rather than needing a separate action.
const HexTile = ({ item, accentColor, filled, renderOverlayBody, onTileSelect }) => (
  <div
    className={`hex-cell ${hexCell}`}
    onClick={(e) => {
      const isNowOpen = toggleHexSelection(e)
      if (isNowOpen && onTileSelect) onTileSelect(item)
    }}
  >
    <div className={hexOutlineStyles(accentColor)}>
      <div className={hexFill} style={{ background: filled ? accentColor : NERV_BG }}>
        <span className={hexTriangle} style={{ color: filled ? HEX_FILL_TEXT : accentColor }}>▲</span>
        <span className={hexLabel} style={{ color: filled ? HEX_FILL_TEXT : accentColor }}>{item.name}</span>
        {item.subtitle && (
          <span className={hexSubtitle} style={{ color: filled ? HEX_FILL_TEXT : accentColor }}>{item.subtitle}</span>
        )}
        <span className={hexTriangle} style={{ color: filled ? HEX_FILL_TEXT : accentColor }}>▼</span>
      </div>
    </div>
    <div className={`hex-overlay ${hexOverlayStyles(accentColor)}`}>
      {renderOverlayBody(item, accentColor)}
    </div>
  </div>
)

const HexGrid = ({ items, accentColor, fillPredicate, renderOverlayBody, onTileSelect, groupKey, serpentine }) => (
  <div className={hexWrap}>
    <div className={hexGrid}>
      {chunkIntoColumns(items, groupKey, serpentine).map((column, i) => (
        <div className={hexColumn} key={i}>
          {column.map((item) => (
            <HexTile
              key={item.key || item.path || item.name}
              item={item}
              accentColor={accentColor}
              filled={fillPredicate(item)}
              renderOverlayBody={renderOverlayBody}
              onTileSelect={onTileSelect}
            />
          ))}
        </div>
      ))}
    </div>
  </div>
)

// Tray - see the css comment above (`trayBoxStyles`) for the full
// design rationale, including why this is now a permanent CHILD of
// cardOuter (a sibling of cardInner) instead of a conditionally-mounted
// sibling of the whole card.
// `tray-wrap` is a plain literal class (same "literal class
// alongside Emotion's hash" trick used for `.detail`/`.nested` elsewhere)
// so toggleTray's click handler can find its own root via
// `closest()` without needing a ref of its own.
// Explicit onMouseEnter/onMouseLeave still needed here (2026-08-04) even
// though this is now a real DOM child of cardOuter - being DOM-nested
// doesn't automatically make cardOuter's own mouseenter/mouseleave fire
// when the pointer moves onto this element, since `position: absolute`
// pulls it outside cardOuter's normal rendered box/hit region (native
// mouseenter/mouseleave key off an element's actual geometry, not just
// DOM parent-child structure). So this still directly calls
// disarmCollapse/armCollapse on the captured `cardNode` - per Ian: "when
// this flips out... that now needs to register as true since the tracker
// size has expanded."
// onMouseLeave also resets any active hex overlay (2026-08-04) - per Ian:
// "if you leave the skill tray it just resets." Same handler, just one
// more call alongside the existing armCollapse.
const Tray = ({ id, accentColor, label, count, children }) => {
  if (!count) return null
  return (
    <div
      className={`tray-wrap ${trayBoxStyles(accentColor)}`}
      data-tray-id={id}
      onMouseEnter={() => { if (cardNode) disarmCollapse(cardNode) }}
      onMouseLeave={(e) => {
        if (cardNode) armCollapse(cardNode)
        resetHexSelection(e.currentTarget)
      }}
    >
      {/* onClick lives on the header zone only, not the whole box
          (2026-08-04) - a click anywhere in the now-unified box would
          otherwise bubble up and toggle the tray shut while someone's
          just trying to interact with a row in the open skill list. */}
      <div className={trayHandleZone} onClick={(e) => toggleTray(id, e)}>
        <span className={trayCountStyles(accentColor)}>{count}</span>
        <span className={trayLabel}>{label}</span>
      </div>
      <div className={`tray-list ${trayListGrid}`}>
        <div className={trayListInner}>{children}</div>
      </div>
    </div>
  )
}

// 2026-07-31: Ian - "seeing everything expanded at once is a little
// jarring" - the summary line gets a slight bold/brightness lift so the eye
// has one clear thing to land on first when a detail panel opens, rather
// than every line reading with equal weight.
const detailSummary = css`
  font-weight: 600;
  color: ${NERV_TEXT};
`

// Clickable rows (idea incubate panel) - see copyPrompt()
// up top. Cursor + hover feedback so it's clear these are interactive,
// distinct from the plain read-only rows around them.
const clickableRow = css`
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.2s ease, color 0.2s ease;

  &:hover {
    background: rgba(255, 107, 26, 0.12);
    color: ${NERV_ORANGE};
  }
`

// Cursor-only variant (2026-07-31, per-section hover color pass) - same
// cursor/interactive affordance as clickableRow, minus its fixed orange
// hover color, for spots that need a section-specific color instead (Needs
// Attention rows below, combined with hoverTint(STATUS_RED)).
const clickableCursor = css`
  cursor: pointer;
  border-radius: 3px;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
`

// Next-steps rows (2026-08-04, simplified). History: this went through six
// rounds of a git-flow-style connector - static border ticks, a border-
// radius "arc" box, a hand-drawn SVG path that drew itself on hover, then a
// single cursor-tracking dot that followed the mouse and "docked" onto the
// nearest row. Ian's call after living with it: "remove the moving ball/
// line/gitflow arc aesthetic thing, it just isn't working." Pulled the
// whole connector/tracking-dot mechanism out rather than tuning it a
// seventh time - plain rows, full-bleed hover tint (the "highlight the
// whole bar like a dropdown menu" read Ian liked much earlier), still
// click-to-copy a continue-work prompt. Nothing about the click behavior
// changed, only the connector visuals are gone.
const stepsWrap = css`
  display: flex;
  flex-direction: column;
`

const stepRow = css`
  position: relative;
  margin: 0 -9999px;
  padding: 2px 9999px;
  cursor: pointer;
  transition: background 0.2s ease;
`

const stepRowInner = css`
  display: flex;
  align-items: center;
  min-height: 20px;
`

const stepRowTint = (color) => css`
  &:hover {
    background: color-mix(in srgb, ${color} 14%, transparent);
  }
`

const detailLabel = css`
  color: ${NERV_ORANGE};
  text-transform: uppercase;
  font-size: 9px;
  letter-spacing: 0.08em;
`

// Subsub-headers (2026-07-31), per Ian: "summary last completed next steps
// time estimate these should all be collapsed and expandable children on
// hover too" - the same restructure just built for Needs Attention groups,
// applied one level deeper to each project's own detail fields. Each field
// becomes its own collapsed-by-default subheader (just the label) that
// reveals its content on hover - reusing collapsibleSection/nestedList
// exactly as-is, now correctly scoped to its own direct child only (see
// collapsibleSection's own comment on the bug that fix addressed).
// `detailLabel`'s old `:first-of-type` spacing trick moved here, onto
// SubField's own wrapper (`:first-child` scoped to detailInner's real
// children now) - it doesn't carry over cleanly with each label living
// inside its own isolated wrapper, where every label would trivially
// qualify as "first" on its own.
const subField = css`
  margin-top: 6px;
  &:first-child {
    margin-top: 0;
  }
`

const SubField = ({ label, children }) => (
  <div className={`${collapsibleSection} ${subField}`}>
    <div className={detailLabel}>{label}</div>
    <div className={`nested ${nestedList}`}>
      <div className={nestedInner}>{children}</div>
    </div>
  </div>
)

// `color` added to each entry (2026-07-31, per Ian: "just want to test out"
// each project row highlighting in its own section's color on hover - the
// same color each section's icon already uses, so this isn't a new palette
// decision, just reusing what's already established). Done's "green" is
// STATUS_TEAL - the closest already-established color to what Ian described,
// since IconDone has used teal (not a second pure green) since the icon set
// was built; flagging this rather than silently guessing he meant something
// else. Dormant gets NERV_TEXT_DIM (its own icon's color) for consistency,
// even though Ian's list didn't explicitly name it.
const SECTION_META = {
  active: { Icon: IconActive, label: "Active", color: STATUS_GREEN },
  idea: { Icon: IconIdea, label: "Idea", color: NERV_AMBER },
  paused: { Icon: IconPaused, label: "Paused", color: STATUS_BLUE },
  // Real status, added 2026-07-31 (Ian: "we still need a backlog section here
  // too") - the structural piece only: a real INDEX.md status key a project
  // can be tagged with, its own section here, sorted most-recently-touched
  // like Active/Paused/Done. What's NOT built yet is the automated lifecycle
  // around it (4hr Active fade, an actual promotion threshold into Backlog,
  // Backlog→Dormant specifically at 2 weeks vs the general 30-day rule, the
  // nightly resort job) - that's real design + cross-file work, still logged
  // in NEEDS-IAN.md as its own next step, not guessed at here. For now this
  // section exists and works, it just starts empty until something's
  // actually tagged 🔵 in INDEX.md.
  backlog: { Icon: IconBacklog, label: "Backlog", color: STATUS_PURPLE },
  done: { Icon: IconDone, label: "Done", color: STATUS_TEAL },
  // Not a real status (see status_summary.py's collect_stale_projects) - every
  // project flagged stale anywhere else, surfaced as its own subheader
  // (2026-07-31, per Ian: wanted this listed as a subheader alongside the
  // real statuses, not buried as plain text inside Needs Attention).
  dormant: { Icon: IconDormant, label: "Dormant", color: NERV_TEXT_DIM },
  // Also not a real INDEX.md status (2026-08-04) - reads from _bin/BIN.md
  // instead (see status_summary.py's load_bin_items). Discarded projects/
  // ideas, kept visible so "discard" doesn't mean "vanish with no record."
  bin: { Icon: IconBin, label: "Bin", color: NERV_TEXT_DIM },
}

const formatHoursAgo = (hoursAgo) => {
  if (hoursAgo == null) return null
  if (hoursAgo < 1) return `${Math.round(hoursAgo * 60)}m ago`
  if (hoursAgo < 24) return `${Math.round(hoursAgo)}h ago`
  return `${Math.round(hoursAgo / 24)}d ago`
}

// formatReportHoursAgo (2026-08-06) - ported from report-viewer/index.jsx's
// own formatHoursAgo verbatim, including its 48h (not 24h) hour/day
// cutover - a real, if small, tuned difference from this file's own
// formatHoursAgo (used for "Last touched: X"), kept as a separate named
// function rather than unified, since unifying the two thresholds is an
// unrelated behavior change out of scope for this work.
const formatReportHoursAgo = (hoursAgo) => {
  if (hoursAgo == null) return null
  if (hoursAgo < 1) return `${Math.round(hoursAgo * 60)}m ago`
  if (hoursAgo < 48) return `${Math.round(hoursAgo)}h ago`
  return `${Math.round(hoursAgo / 24)}d ago`
}

// Report titles look like "🌙 Morning Report — for 2026-08-06" - strips the
// leading emoji (rendered separately/redundantly next to a text label would
// look odd here) and keeps the rest as-is.
const cleanReportTitle = (title) => {
  if (!title) return "Latest report"
  return title.replace(/^[^\w]+/, "").trim()
}

// findSection (ported verbatim) - report headings aren't a fixed,
// guaranteed contract, so this matches by pattern instead of an exact key.
// Skips empty sections rather than showing an empty panel.
const findSection = (sections, patterns) => {
  if (!sections) return null
  const keys = Object.keys(sections)
  for (const pattern of patterns) {
    const key = keys.find((k) => pattern.test(k) && sections[k] && sections[k].length > 0)
    if (key) return sections[key]
  }
  return null
}

const REPORTS_BULLET_CAP = 3

// REPORT_SOURCE_LABELS (2026-08-08, shortened 2026-08-10, corrected same
// day) - short, fixed hex-face labels. The real bug in the original
// "IANLOGGER"/"DEPENDENCY AUDIT" labels was never their length - it was
// that a single unbroken word with nowhere to wrap gets fragmented
// mid-word inside hexLabel's 50px box ("IANLOGG"/"ER"). "MORNING REPORT"
// never had this problem: it already wraps cleanly at the space between
// two real words. The first fix over-corrected to bare single-word labels
// ("LOG"/"REPORT"/"AUDIT") that lost the source identity - per Ian, "i
// should know what log it is." Real fix: keep labels descriptive, just
// make sure every individual word is short enough (roughly <=7-8 chars at
// this box width/font) to fit its own line without needing a mid-word
// break. The real title/date still shows in the overlay
// (renderReportOverlayBody below), same as every other hex in this tray
// system already does.
const REPORT_SOURCE_LABELS = {
  ianlogger: "IAN LOG",
  usage_scheduler: "MORNING REPORT",
  dependency_audit: "DEPS AUDIT",
}

// formatHexDate (2026-08-10) - compact MM-DD form of an archive
// instance's own YYYY-MM-DD id, for the hex face subtitle. Every Plan-A
// source's id is guaranteed to match that shape (list_dated_files only
// ever returns files DATE_RE already matched), so a plain slice is safe -
// no parsing/reformatting needed. Year is dropped since every backlog hex
// currently visible is recent enough that the month/day alone disambiguates
// same-source stacks; revisit if a source's backlog ever spans a year
// boundary in practice.
const formatHexDate = (id) => (id && id.length >= 10 ? id.slice(5) : id)

// reportsItems (2026-08-08, rebuilt for Reports Tray v2's uniform payload;
// `subtitle` added 2026-08-10; chronological cross-source sort added same
// day) - flattens every source's `instances` list into one flat hex-item
// array. Each item carries `reportSource` (the key mark_report_viewed.py
// needs) and `id` (the instance's own date) alongside the usual
// `key`/`kind`/`name`/`data` shape every other hex item in this file
// already uses. `subtitle` is the compact-date second face line (see
// hexSubtitle/HexTile) - per Ian, several stacked same-source hexes (e.g.
// five IAN LOG hexes) were indistinguishable from the outside without
// opening each one.
//
// Final sort by `id` (2026-08-10) - per Ian: "i dont think we need
// columns organized by their log they can just be arranged in serpentine
// fashion in this general chronological order." The per-source grouping
// this used to rely on (still available as `chunkIntoColumns`'s
// `groupKey` mode, just no longer used here) is gone - every instance
// from every source now sorts into one single oldest-first timeline
// before `chunkIntoColumns(items, undefined, true)` lays it out
// serpentine-fashion at the call site below. `id` sorts correctly as a
// plain string since every source's id is a YYYY-MM-DD date.
const reportsItems = (reports) => {
  const items = []
  Object.keys(REPORT_SOURCE_LABELS).forEach((source) => {
    const instances = (reports && reports[source] && reports[source].instances) || []
    instances.forEach((instance) => {
      items.push({
        key: `${source}-${instance.id}`,
        kind: source,
        reportSource: source,
        id: instance.id,
        name: REPORT_SOURCE_LABELS[source],
        subtitle: formatHexDate(instance.id),
        viewed: instance.viewed,
        data: instance,
      })
    })
  })
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return items
}

const renderReportOverlayBody = (item, accentColor) => {
  const instance = item.data

  if (item.kind === "ianlogger") {
    return (
      <div>
        <div className={skillRowName} style={{ fontSize: 13 }}>{item.name}</div>
        <div className={skillOverlaySection}>
          <div className={overlayLabelStyles(accentColor)}>{instance.date} · {formatReportHoursAgo(instance.hours_ago)}</div>
          <div className={skillOverlayBody}>{instance.text}</div>
        </div>
      </div>
    )
  }

  if (item.kind === "usage_scheduler") {
    const completed = findSection(instance.sections, [/completed/i])
    const needsYou = findSection(instance.sections, [/still needs you/i, /needs you/i])
    return (
      <div>
        <div className={skillRowName} style={{ fontSize: 13 }}>{cleanReportTitle(instance.title)}</div>
        <div className={skillOverlaySection}>
          <div className={overlayLabelStyles(accentColor)}>{item.id} · {formatReportHoursAgo(instance.hours_ago)}</div>
        </div>
        {completed && (
          <div className={skillOverlaySection}>
            <div className={overlayLabelStyles(accentColor)}>Completed</div>
            <ul className={reportsBulletList}>
              {completed.slice(0, REPORTS_BULLET_CAP).map((line, i) => (
                <li className={reportsBulletItem} key={i}>{line}</li>
              ))}
            </ul>
            {completed.length > REPORTS_BULLET_CAP && (
              <div className={reportsMoreNote}>+{completed.length - REPORTS_BULLET_CAP} more completed</div>
            )}
          </div>
        )}
        {needsYou && (
          <div className={skillOverlaySection}>
            <div className={overlayLabelStyles(accentColor)}>Needs you</div>
            <ul className={reportsBulletList}>
              {needsYou.slice(0, REPORTS_BULLET_CAP).map((line, i) => (
                <li className={reportsAttentionBulletItem} key={i}>{line}</li>
              ))}
            </ul>
            {needsYou.length > REPORTS_BULLET_CAP && (
              <div className={reportsMoreNote}>+{needsYou.length - REPORTS_BULLET_CAP} more needs you</div>
            )}
          </div>
        )}
        {!completed && !needsYou && <div className={skillOverlayBody}>nothing to report</div>}
      </div>
    )
  }

  // dependency_audit
  return (
    <div>
      <div className={skillRowName} style={{ fontSize: 13 }}>{item.name}</div>
      <div className={skillOverlaySection}>
        <div className={overlayLabelStyles(accentColor)}>{instance.title}</div>
        <div className={skillOverlayBody}>{item.id}</div>
      </div>
    </div>
  )
}

// markReportViewed (2026-08-08, Reports Tray v2) - HexGrid's onTileSelect
// handler for this tray. Shells out via Übersicht's run() the same way
// copyPrompt already does for copy-to-clipboard - not a new interaction
// pattern for this file. No-ops for an already-viewed item (nothing to
// mark). Absolute paths, same convention CLAUDE_SPACE_FOLDER and this
// widget's own `command` export already use throughout this file - this
// is a personal, single-user widget, not meant to be portable.
const REPORTS_VIEWED_CONFIG_PATH = "/Users/ianerickson/Desktop/Projects/dashboard-visualizer/config/reports_viewed.json"
const MARK_REPORT_VIEWED_SCRIPT_PATH = "/Users/ianerickson/Desktop/Projects/dashboard-visualizer/scripts/mark_report_viewed.py"

const markReportViewed = (item) => {
  if (item.viewed) return
  run(
    `python3 '${MARK_REPORT_VIEWED_SCRIPT_PATH}' --config '${REPORTS_VIEWED_CONFIG_PATH}' --source '${item.reportSource}' --id '${item.id}'`
  ).catch(() => {})
}

// reportsPillLabel (2026-08-08, rebuilt for Reports Tray v2) - counts
// total instances across all three sources instead of computing a
// freshness token. An item COUNT fits this tray's new shape better than
// v1's "hours since freshest" did, now that there can genuinely be more
// than one hex per source (the backlog stacking case) - "3" unread is a
// more useful glance-signal here than which one is freshest. Tray's
// existing `if (!count) return null` gate works unchanged: 0 unread
// hides the tray only when there's also nothing to show at all - but the
// tray should still show once a source has ANY instance (even fully
// read), same as Skill/Script Tray never hide just because nothing's
// "new". So this counts TOTAL instances, not just unread ones - matches
// Tray's existing count semantics (an item count, not a badge count).
const reportsPillLabel = (reports) => reportsItems(reports).length

const formatResetCountdown = (daysLeft, hoursLeft) => {
  if (daysLeft <= 0) return `${hoursLeft}h`
  return `${daysLeft}d ${hoursLeft}h`
}

// formatHealthGauge / resetHealthTimer (2026-07-31, per Ian: "another timer
// bar that I want to monitor here is personal health bar that monitors time
// since last break and counts down from an hour... tie this to the mental
// and personal health check stuff" - i.e. wellbeing-check). Mirrors
// formatSessionReset's short-value convention; clicking the gauge marks a
// break taken right now (writes a fresh last_break_at to
// config/last_break.json via `run`, same base64-safe echo pattern
// copyPrompt already uses for pbcopy) so the countdown is something Ian
// actually resets in the moment, not a display-only number that silently
// goes stale like session_reset can.
// "away" branch added (2026-08-02), per Ian: "change the icon to a little
// z's or sleeping to signify I am away... I don't want it to be in the
// 'needs a break' when I just am inactive or away." status_summary.py
// already forces overdue: false while away (see load_personal_health's own
// comment) - this just swaps the label text to match, ahead of the
// overdue/countdown branches below.
const formatHealthGauge = (health) => {
  if (!health) return null
  if (health.away) return "away"
  if (health.overdue) return "overdue"
  const h = Math.floor(health.minutes_left / 60)
  const m = health.minutes_left % 60
  return h > 0 ? `~${h}h ${m}m` : `~${m}m`
}

const LAST_BREAK_CONFIG_PATH = "/Users/ianerickson/Desktop/Projects/dashboard-visualizer/config/last_break.json"

// healthHueColor (2026-07-31) - same green(120)->red(0) HSL sweep the big
// gauge's own fill uses (see resetGaugeFill/ResetGauge's comment), factored
// out here so the mini-mode pill icon below can match it exactly instead of
// re-deriving its own color logic. "away" branch added (2026-08-02): the
// green->red urgency sweep isn't meaningful while Ian's genuinely away (the
// countdown is frozen, not real pressure), so away gets its own calm, fixed
// color instead of wherever the frozen fraction happens to land on the hue
// sweep - same blue IconPaused already uses elsewhere in this file, since
// "away" and "paused" are the same idea (intentionally not counting against
// anything right now).
const healthHueColor = (health) => {
  if (!health) return `hsl(120, 85%, 55%)`
  if (health.away) return STATUS_BLUE
  const remainingFraction = 1 - health.elapsed_fraction
  const hue = Math.round(Math.max(0, Math.min(1, remainingFraction)) * 120)
  return `hsl(${hue}, 85%, 55%)`
}

// Root-cause bug fix (2026-08-02), per Ian: clicking multiple times was
// stacking ~60m per click (observed: 360m after several clicks). Real cause
// wasn't the click handler stacking anything - `toISOString()` returns UTC
// ("...T01:07:26" while Ian's actual local time was 20:07 CDT, a 5-hour
// gap), but status_summary.py's load_personal_health parses last_break_at
// as NAIVE LOCAL time (datetime.now(), no tz) - same convention
// session_reset.json already uses. Every click wrote a UTC timestamp that
// read as ~5 hours in Ian's own future once Python compared it against
// local "now," so minutes_left came out as 60 + that offset (~360m) - and
// because each click re-derives "now" independently, re-clicking didn't
// cleanly reset to 60, it just recomputed a similarly-inflated number,
// reading as if it kept climbing. Fixed by formatting local wall-clock time
// by hand (getFullYear/getMonth/etc., not toISOString/getUTC*) so the
// written value matches exactly what Python expects - one click now sets a
// clean, exact 60:00 countdown, full stop, no drift, no stacking.
const toLocalIso = (date) => {
  const pad = (n) => String(n).padStart(2, "0")
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

const resetHealthTimer = () => {
  const nowIso = toLocalIso(new Date())
  const payload = JSON.stringify({
    last_break_at: nowIso,
    note: "Updated by the widget's own click-to-reset (mark break taken).",
  })
  const b64Payload = btoa(unescape(encodeURIComponent(payload)))
  run(`echo ${b64Payload} | base64 -D > "${LAST_BREAK_CONFIG_PATH}"`).catch(() => {})
}

const formatSessionReset = (session) => {
  if (!session) return null
  // 2026-07-31: was a long "unknown (last reported...)" string crammed into the
  // value slot - Ian flagged it as unhelpful clutter. Short value here, the
  // fuller explanation lives in the separate .resetStale line below it.
  if (session.already_passed) return "stale"
  const h = Math.floor(session.minutes_left / 60)
  const m = session.minutes_left % 60
  return h > 0 ? `~${h}h ${m}m` : `~${m}m`
}

// NERV/MAGI-style depleting gauges (2026-07-31, per Ian, two rounds of
// feedback in a row: first "I don't need rolling/approximate... I'd love a
// little time bar that ticks down in the NERV MAGI computer aesthetic," then
// live on seeing it - "not clear which is which" between Session and Weekly
// usage, wanted both trackers gauged, bar aligned right under its own label
// with the value underneath it, and "more NERV like... visuals of bars being
// depleted on their computer screens." One shared `ResetGauge` now renders
// BOTH Session and each Weekly usage entry identically - label left, a
// blocky/segmented bar (repeating-linear-gradient slices instead of a smooth
// fill - the classic MAGI power-gauge read, not a plain progress bar) plus
// its value stacked right underneath, right-aligned under the label so it's
// unambiguous which reading a given bar belongs to. Doesn't change what's
// actually knowable in either case (still a manually-reported session anchor,
// still a fixed weekly calendar target) - purely a display upgrade; see
// status_summary.py's elapsed_fraction comments on both load_session_reset
// and load_usage_resets for how each fraction is actually computed. Fill
// width represents time REMAINING (depletes toward empty), not elapsed.
const resetGaugeTrack = css`
  position: relative;
  width: 100%;
  height: 7px;
  /* Second alignment nudge (2026-07-31, per Ian, live: "still a little higher
     than their corresponding session thing... shouldn't be above the font of
     the session lettering"). flex-start lines up the two columns' boxes, but
     text has its own line-height padding above the glyphs themselves, so the
     bar (a plain box with no such padding) still read a couple px higher
     than where the label's actual letters start. Small margin-top closes
     that visual gap instead of restructuring the alignment model again. */
  margin-top: 3px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid ${NERV_LINE};
  overflow: hidden;
`

// Color-coded by time remaining (2026-07-31), per Ian: "slight coloring for
// the time elapse bars - they should start green when closer to full and go
// green yellow orange red when close to end." The gauge's own colors were
// fixed (orange/amber) regardless of how much time was actually left - now
// driven by remainingFraction via a plain HSL hue sweep (green, hue 120, at
// full -> red, hue 0, at empty), computed once in ResetGauge and passed down
// as CSS custom properties rather than baking a color into the shared class
// - the segmented/blocky MAGI-style fill pattern itself is unchanged, just
// which color it's drawn in. A hue sweep naturally passes through yellow
// (~60) around the midpoint and orange (~30) approaching empty, matching the
// green -> yellow -> orange -> red sequence Ian described without needing
// four hardcoded threshold colors.
const resetGaugeFill = css`
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    90deg,
    var(--gauge-color) 0px,
    var(--gauge-color) 5px,
    var(--gauge-color-light) 5px,
    var(--gauge-color-light) 6px,
    transparent 6px,
    transparent 8px
  );
  box-shadow: 0 0 6px var(--gauge-glow);
  transition: width 1.2s linear, background 0.6s ease, box-shadow 0.6s ease;
  animation: scan 2.4s ease-in-out infinite;
`

// staleText / onClick (2026-07-31, added for the personal-health gauge
// below): both optional so Session/Weekly usage - the two existing callers -
// render exactly as before (default stale message, no click affordance).
// Stale message moved inline (2026-08-04), per Ian: "keep them same spacing
// on all the bars... maybe have it inline next to the time." Now rendered
// INSIDE resetValueRight, right after valueText on the same line, instead of
// as a second block-level line below it - resetBarCol is always exactly
// "bar + one value line" now, so every gauge stays the same height whether
// or not it currently has a stale/reset message.
const ResetGauge = ({ label, valueText, remainingFraction, stale, staleText, onClick, icon }) => {
  const remainingPct = Math.max(0, Math.min(100, Math.round((remainingFraction ?? 0) * 100)))
  const hue = Math.round(Math.max(0, Math.min(1, remainingFraction ?? 0)) * 120)
  const gaugeVars = {
    "--gauge-color": `hsl(${hue}, 85%, 55%)`,
    "--gauge-color-light": `hsl(${hue}, 90%, 72%)`,
    "--gauge-glow": `hsla(${hue}, 85%, 55%, 0.55)`,
  }
  return (
    <div
      className={onClick ? `${resetItem} ${clickableCursor} ${hoverTint(NERV_ORANGE)}` : resetItem}
      onClick={onClick}
    >
      <span className={resetItemLabel}>
        <span className={resetItemIconSlot}>{icon}</span>
        {label}
      </span>
      <div className={resetBarCol}>
        <div className={resetGaugeTrack}>
          <div className={resetGaugeFill} style={{ width: `${remainingPct}%`, ...gaugeVars }} />
        </div>
        <span className={resetValueRight}>
          {valueText}
          {stale && <span className={resetStale}>{staleText || "needs a check-in"}</span>}
        </span>
      </div>
    </div>
  )
}

// isIdea (2026-07-31, per Ian: "make it so clicking an idea triggers incubator
// skill so if I want to build an idea I can click and we start incubating").
//
// Revised same day, per Ian's direct feedback on the first version: no
// separate "Incubate this idea →" row with an arrow - "the whole expanded
// item should just be clickable... I don't always need instructions
// implemented in a design, I like that we're designing some stuff to be
// intuitive." The click now lives on the whole detail panel itself
// (detailInner gets the clickableRow treatment - cursor + hover tint is the
// only affordance, no label explaining what it does). Same instinct applied
// below: dropped the "(click to start)" parenthetical off the Next Steps
// label - the hover color shift on each step already says "this is
// clickable" without a caption spelling it out.
// isPaused (2026-07-31, per Ian: "for the pause you should be able to click
// it and it will add it either to active or idea depending on whats
// paused"). Same click-to-copy-a-prompt pattern as isIdea's incubate handler
// above, not a direct file mutation - consistent with every other click in
// this widget (the widget itself never writes to INDEX.md/README.md, it
// hands a prompt to Claude to do the real edit, respecting PROCESS.md's own
// conventions and keeping a real Notes trail). The "active or idea depending
// on what's paused" judgment call - does this project have real progress to
// resume (→ Active) or was it barely started (→ Idea) - isn't something this
// script can reliably infer from a filename alone, so the prompt hands that
// decision to whoever picks it up, same as every other prompt here defers
// real judgment calls rather than guessing at a brittle heuristic.
const ProjectRow = ({ item, isIdea, isPaused, color }) => {
  const agoText = formatHoursAgo(item.hours_ago)
  const incubate = (e) => {
    e.stopPropagation()
    copyPrompt(
      `Use the incubator skill to flesh out the idea "${item.name}"` +
        `${item.summary ? `: ${item.summary}` : ""}. This is a bare-bones idea from ` +
        `ClaudeSpace's INDEX.md, not yet a real project - work through incubator's ` +
        `interview (basic version, future features, end goal, then a Goal + Sub-projects ` +
        `checklist ready for PROCESS.md Step 3).`,
      e.currentTarget
    )
  }
  const resume = (e) => {
    e.stopPropagation()
    copyPrompt(
      `Un-pause the "${item.name}" project (ClaudeSpace, currently ⏸️ Paused). Look at its own ` +
        `README.md and decide whether it should move to 🟢 Active (it has real progress - checked-` +
        `off steps, Notes entries - worth resuming where it left off) or back to 🟡 Idea (it never ` +
        `really got past the concept stage). Update its status emoji in INDEX.md accordingly, and ` +
        `add a dated Notes entry in its own README.md noting the un-pause.`,
      e.currentTarget
    )
  }
  const rowClick = isIdea ? incubate : isPaused ? resume : undefined
  return (
    <div className={color ? `${projectItem} ${hoverTint(color)}` : projectItem}>
      <span>
        {item.name}
        {item.stale && (
          <span className={staleTag}>
            <IconDormant size={9} /> dormant
          </span>
        )}
        {agoText && <span style={{ color: "rgba(255,255,255,0.35)" }}> · {agoText}</span>}
      </span>
      <div className={`detail ${detail}`} style={color ? { borderLeftColor: color } : undefined}>
        <div
          className={rowClick ? `${detailInner} ${clickableRow}` : detailInner}
          onClick={rowClick}
        >
          {item.summary && (
            <SubField label="Summary">
              <div className={detailSummary}>{item.summary}</div>
            </SubField>
          )}
          {item.last_completed && (
            <SubField label="Last completed">
              <div>{item.last_completed}</div>
            </SubField>
          )}
          {item.next_steps && item.next_steps.length > 0 && (
            <SubField label="Next steps">
              <div className={`steps-wrap ${stepsWrap}`}>
                {item.next_steps.map((step, i) => (
                  <div
                    className={`step-row ${stepRow} ${stepRowTint(color || NERV_ORANGE)}`}
                    key={i}
                    onClick={(e) => {
                      e.stopPropagation()
                      copyPrompt(
                        `Continue work on the "${item.name}" project (ClaudeSpace) - next step: ${step}. ` +
                          `Before starting: read PROCESS.md and PHILOSOPHY.md in this folder for the ` +
                          `tracker's conventions. When you finish this step, update ${item.name}'s own ` +
                          `README.md (check the step off, add a Notes entry) so the Commandspace widget ` +
                          `and any future session pick it up automatically.`,
                        e.currentTarget
                      )
                    }}
                  >
                    <div className={stepRowInner}>
                      <span>{step}</span>
                    </div>
                  </div>
                ))}
              </div>
            </SubField>
          )}
          {item.time_estimate && (
            <SubField label="Time estimate">
              <div>{item.time_estimate}</div>
            </SubField>
          )}
        </div>
      </div>
    </div>
  )
}

// 2026-07-31: Done used to be a special case - only its 3 most recent items,
// no way to see the rest. Per Ian ("everything in tiny mode should be
// expandable and viewable in big mode"), unified it with Idea's pattern:
// every section (including Done) shows its FULL list, collapsible sections
// just default to only the header until hovered. `section.shown` is already
// the complete list for every status - status_summary.py stopped truncating
// it back in the earlier scrolling fix.
//
// Empty sections (2026-07-31, per Ian: "for every item in tiny mode I want
// to see a subsection in big mode even if there's nothing and it doesn't
// expand"): the header always renders now, even at 0 - only the hover-expand
// behavior (and the list itself) is skipped when there's nothing to show, so
// an empty section just sits there as a flat, non-interactive line instead
// of disappearing.
// recentCount (2026-07-31, per Ian - the "Done count is often just 0"
// question, answered): Done specifically also shows how many were marked
// done in the last 2 weeks next to the plain lifetime total, so big mode
// carries both numbers Ian asked for ("total done and then done recently") -
// tiny mode shows only the recent count (see render()'s tinyRow).
const Section = ({ statusKey, section, collapsible, recentCount }) => {
  const meta = SECTION_META[statusKey]
  const total = section ? section.total : 0
  const hasItems = total > 0

  const items = section
    ? section.shown.map((item) => (
        <ProjectRow
          item={item}
          isIdea={statusKey === "idea"}
          isPaused={statusKey === "paused"}
          color={meta.color}
          key={item.name}
        />
      ))
    : []
  const list = hasItems && collapsible ? (
    <div className={`nested ${nestedList}`}>
      <div className={`${nestedInner} ${scrollList}`}>{items}</div>
    </div>
  ) : (
    hasItems && <div className={scrollList}>{items}</div>
  )

  return (
    <div className={hasItems && collapsible ? collapsibleSection : undefined}>
      <div className={sectionHeader}>
        <span className={sectionHeaderLabel}><meta.Icon /> {meta.label}</span>
        <span className={sectionHeaderCount}>{total}</span>
      </div>
      {/* Alignment fix (2026-07-31, per Ian: "the orange numbers all need to
          align... for done that should be total items, maybe grey note that
          N done recently, don't need the specific two weeks part"). The count
          above is the plain total again, same as every other section - right
          edge lines up with everyone else's. "Recently done" moved off that
          line entirely into its own small muted caption underneath, so it
          can't push the bracket out of alignment no matter how long it gets. */}
      {recentCount != null && recentCount > 0 && (
        <div className={sectionSubnote}>{recentCount} recently done</div>
      )}
      {list}
    </div>
  )
}

// DailyGoals (2026-08-04) - the goal-for-day panel restyled from a single
// bold-orange line into a real Section, per Ian: "can the goal for the day
// be a list as well and have daily goals as a header... more readable...
// also daily goals should be another thing that is collapsable/expandable.
// most new implementations to command space should follow this pattern
// generally." Deliberately reuses Section's own building blocks
// (sectionHeader/sectionHeaderLabel/sectionHeaderCount for the header,
// collapsibleSection/nestedList/nestedInner/scrollList for the hover-reveal
// list) rather than introducing a second visual language - this is now the
// go-to shape for anything new added to Commandspace, not a one-off.
// Row-level treatment revised same day, per Ian's direct follow-up: "have
// it match the style of the other collapseabile sections and have brief
// summary that can be explandable and have it clickable so that i can
// work on it in a new thread" - see GoalRow (near AttentionEntryRow below)
// for the individual-item shape this now uses instead of a plain styled
// div.
const DailyGoals = ({ dailyGoal }) => {
  const rawGoals = dailyGoal && dailyGoal.goals ? dailyGoal.goals : []
  if (!dailyGoal || rawGoals.length === 0) return null

  // Per-item completion + reorder (2026-08-04 follow-up), per Ian: "when a
  // goal's real item gets completed the goal can remain for the day but
  // have strike thru and move to the bottom of the daily goals." Each goal
  // now carries its own `completed` (see status_summary.py's
  // project_needs_ian_status/load_daily_goal) instead of every row sharing
  // one all-or-nothing flag - stable-sort (Array.sort is spec-guaranteed
  // stable) puts completed items last without disturbing the relative
  // order within either group, and nothing gets removed from the list -
  // the point is a visible sense of progress through today's actual goals,
  // not a shrinking list.
  const goals = [...rawGoals].sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0))
  // Header count bumps down as items complete (2026-08-04 follow-up), per
  // Ian: "when a goal is completed it the daily goal count should bump
  // down." Was `goals.length` (static total) - now the count of what's
  // still actually open, same "this number should move as real progress
  // happens" spirit as needs_ian_count elsewhere in this file.
  const remainingCount = goals.filter((g) => !g.completed).length

  return (
    <div className={collapsibleSection}>
      <div className={sectionHeader}>
        <span className={sectionHeaderLabel}><IconGoal /> Daily Goals</span>
        <span className={sectionHeaderCount}>{remainingCount}</span>
      </div>
      <div className={`nested ${nestedList}`}>
        <div className={`${nestedInner} ${scrollList}`}>
          {goals.map((g, i) => (
            <GoalRow key={i} goal={g} completed={g.completed} />
          ))}
        </div>
      </div>
    </div>
  )
}

// 2026-07-31: this section's header now carries the count itself
// (needsIanCount, the real uncapped total) - there used to be a SEPARATE
// "N waiting on you" line elsewhere in big mode pulling from the exact same
// underlying data, which Ian correctly flagged as redundant ("what's the
// difference?"). That standalone line is gone; this is the one place the
// count and the actual items both live now.
//
// Always renders its header now (2026-07-31, same change as Section above) -
// even with zero open items, the header stays put in big mode; only the
// hover-expand and nested list are skipped when empty. Dormant/stale projects
// used to have a flat, unclickable "dormant: name, name" line nested in here -
// moved out into their own real "Dormant" Section (see SECTION_META /
// sections.dormant) so they get the same ProjectRow treatment - hover detail,
// click-to-open-in-Claude - as everything else, instead of being second-class
// plain text.
const attentionPrompt = (title) =>
  `Help address this open item from ClaudeSpace's NEEDS-IAN.md: ${title}. ` +
  `Before starting: read PROCESS.md and PHILOSOPHY.md in this folder for the ` +
  `tracker's conventions. When resolved, mark this item "✅ Resolved" in ` +
  `NEEDS-IAN.md (per its own file's convention) so the Commandspace widget's count ` +
  `drops and it doesn't linger.`

const AttentionEntryRow = ({ entry, indent }) => (
  <div
    className={indent ? `${attentionRow} ${clickableCursor} ${hoverTint(STATUS_RED)} ${groupNestedIndent}` : `${attentionRow} ${clickableCursor} ${hoverTint(STATUS_RED)}`}
    onClick={(e) => {
      e.stopPropagation()
      copyPrompt(attentionPrompt(entry.title), e.currentTarget)
    }}
  >
    <div className={attentionRowTop}>
      <span className={attentionKind}>{entry.kind === "blocked" ? <IconBlocked /> : <IconAsk />}</span>
      <span>{entry.title}</span>
    </div>
    {entry.detail && (
      <div className={`detail ${detail}`} style={{ borderLeftColor: STATUS_RED }}>
        <div className={detailInner}>{entry.detail}</div>
      </div>
    )}
  </div>
)

// GoalRow (2026-08-04) - individual Daily Goals item, per Ian's direct
// follow-up on the section restyle above: "have it match the style of the
// other collapseabile sections and have brief summary that can be
// explandable and have it clickable so that i can work on it in a new
// thread." Deliberately just AttentionEntryRow's exact shape (title row +
// click-to-copy-a-working-prompt + expandable `detail`), orange hover tint
// instead of Needs Attention's red so it still reads as its own category,
// not a re-skin.
//
// Detail panel has gone through three shapes now. First pass used real
// SubFields (Summary/Currently in/Context, each its own independently-
// expandable sub-panel) matching ProjectRow's own multi-field detail -
// per Ian's original ask: "maybe sub sections can be summary, an
// explandable read out of what section it currently lives in and maybe
// the previous context piece." Walked back to one flat concatenated
// block after seeing it live: "the style of goals explandable still is
// weird and different than the others... match the font and styling of
// the text of the other expandables so its standard." Reinstated again
// (2026-08-05), per Ian looking at the flat version live: "can we change
// the font and styling so it matches other things? Summary, currently
// in, etc. these should be expandable children." Reading both rounds of
// feedback together: the actual complaint both times was never "don't
// use SubFields" - it's that whatever rendered didn't visually match
// ProjectRow's real SubFields. The flat-block version technically fixed
// that by sidestepping SubFields entirely, but lost the per-field
// expand/collapse Ian's original ask wanted. This version uses the
// EXACT SAME `SubField` component ProjectRow itself uses (not a
// reimplementation, not a styled copy) - same font, same label styling,
// same nested/collapsible mechanics - so there's no way for it to drift
// from "the other expandables" again.
// requires_code destination note (2026-08-04 follow-up), per Ian: "it
// should specify if it should be pasted into a regular thread or code if
// it requires code or plugins." requires_code comes from status_summary.py
// (see load_daily_goal's own comment) - True when the goal's named project
// is a real repo under `../Projects/`, per PROCESS.md's own code-vs-tracker
// split. Stated plainly up front so pasting this into the wrong surface
// isn't discovered mid-task.
const goalPrompt = (title, detail, requiresCode) =>
  (requiresCode
    ? `This is real code work — paste this into a Code tab session (or Claude Code), not a regular chat thread. `
    : `This is regular tracker/skill work — paste this into a normal Claude/Cowork thread, no code environment needed. `) +
  `Help work on today's Commandspace goal: ${title}.` +
  (detail ? ` ${detail}` : "") +
  ` Before starting: read PROCESS.md and PHILOSOPHY.md in this folder for the ` +
  `tracker's conventions.`

// Bullet icon shrunk to 9px (2026-08-04), smaller than the 12px default
// every other row icon in this file uses - per Ian, twice: "the mini goal
// bullets are a nice touche but theyre too big" and then, still not small
// enough after the first pass, "i like the bullet icons make them
// smaller." Deliberately breaks from matching attentionKind's usual
// icon size exactly, since Ian's calling these "bullets" (a lighter,
// decorative marker) rather than a semantic action icon like IconAsk/
// IconBlocked.
const GoalRow = ({ goal, completed }) => {
  return (
    <div
      className={
        completed
          ? `${attentionRow} ${clickableCursor} ${hoverTint(NERV_ORANGE)} ${goalItemDone}`
          : `${attentionRow} ${clickableCursor} ${hoverTint(NERV_ORANGE)}`
      }
      onClick={(e) => {
        e.stopPropagation()
        copyPrompt(goalPrompt(goal.title, goal.detail, goal.requires_code), e.currentTarget)
      }}
    >
      <div className={attentionRowTop}>
        <span className={attentionKind}>{completed ? <IconGoalDone size={9} /> : <IconGoal size={9} />}</span>
        <span>{goal.title}</span>
      </div>
      <div className={`detail ${detail}`} style={{ borderLeftColor: NERV_ORANGE }}>
        <div className={detailInner}>
          {goal.detail && (
            <SubField label="Summary">
              <div className={detailSummary}>{goal.detail}</div>
            </SubField>
          )}
          {goal.current_section && (
            <SubField label="Currently in">
              <div>{goal.current_section}</div>
            </SubField>
          )}
          {goal.context && (
            <SubField label="Context">
              <div>{goal.context}</div>
            </SubField>
          )}
          <SubField label="Destination">
            <div>{goal.requires_code ? "Code tab (real code work)." : "Regular thread."}</div>
          </SubField>
        </div>
      </div>
    </div>
  )
}

// GroupRow (2026-07-31) - see groupCount's own comment above for the design.
const GroupRow = ({ project, items }) => {
  const hasItems = items && items.length > 0
  return (
    <div className={hasItems ? collapsibleSection : undefined}>
      <div
        className={`${attentionRow} ${clickableCursor} ${hoverTint(STATUS_RED)}`}
        onClick={(e) => {
          e.stopPropagation()
          copyPrompt(
            `Help address these ${items.length} open "${project}" items from ClaudeSpace's ` +
              `NEEDS-IAN.md, together: ${items.map((i) => i.title).join(" | ")}. Before starting: ` +
              `read PROCESS.md and PHILOSOPHY.md in this folder for the tracker's conventions. As ` +
              `each is resolved, mark it "✅ Resolved" in NEEDS-IAN.md (per its own file's convention) ` +
              `so the Commandspace widget's count drops and they don't linger.`,
            e.currentTarget
          )
        }}
      >
        <div className={attentionRowTop}>
          <span className={attentionKind}>
            <IconWarning />
          </span>
          <span>{project}</span>
          <span className={groupCount}>{items.length}</span>
        </div>
      </div>
      {hasItems && (
        <div className={`nested ${nestedList}`}>
          <div className={`${nestedInner} ${scrollList}`}>
            {items.map((entry, i) => (
              <AttentionEntryRow entry={entry} indent key={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const NeedsAttention = ({ needsAttention, needsIanCount }) => {
  const { items, groups } = needsAttention || {}
  const hasItems = (items && items.length > 0) || (groups && groups.length > 0)

  return (
    <div className={hasItems ? collapsibleSection : undefined}>
      <div className={sectionHeader}>
        <span className={sectionHeaderLabel}><IconWarning /> Needs Attention</span>
        <span className={sectionHeaderCount}>{needsIanCount || 0}</span>
      </div>
      {hasItems && (
        <div className={`nested ${nestedList}`}>
          <div className={`${nestedInner} ${scrollList}`}>
            {items && items.map((entry, i) => <AttentionEntryRow entry={entry} key={i} />)}
            {groups && groups.map((group) => (
              <GroupRow project={group.project} items={group.items} key={group.project} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export const render = (state) => {
  const {
    loading,
    error,
    totals,
    needs_ian_count,
    most_recent_project,
    usage_resets,
    session_reset,
    personal_health,
    sections,
    needs_attention,
    daily_goal,
    skills,
    scripts,
    reports,
  } = state

  if (loading) {
    return (
      <div className={cardOuter}>
        <div className={cardInner}>loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cardOuter}>
        <div className={cardInner}>
          <div className={title}>Commandspace</div>
          <div>couldn't read tracker: {error}</div>
        </div>
      </div>
    )
  }

  const hasResets = (usage_resets && usage_resets.length > 0) || session_reset || personal_health

  return (
    // cardOuter is the real root now (2026-08-04) - no separate wrapper div
    // needed to keep `card` and `Tray` as fragment-free siblings
    // anymore, since Tray is a genuine CHILD of cardOuter now (a
    // sibling of cardInner, not of the whole widget) - see cardOuter's own
    // comment for why that split happened. `is-expanded` toggles here,
    // same mechanism as always (`setExpanded`/`armCollapse`/
    // `disarmCollapse`/`toggleExpanded`, all still targeting this exact
    // element via the captured `cardNode` ref) - it just now also drives
    // Tray's own CSS transition as a side effect of living inside
    // this same element, with zero extra JS.
    <div
      className={cardExpanded ? `${cardOuter} is-expanded` : cardOuter}
      ref={(el) => { if (el) cardNode = el }}
      onMouseEnter={(e) => disarmCollapse(e.currentTarget)}
      onMouseLeave={(e) => armCollapse(e.currentTarget)}
    >
      <div className={cardInner}>
      <div className={`${title} ${clickableCursor}`} onClick={toggleExpanded}>Commandspace</div>

      {/* 2026-07-31, per Ian: mini mode was inconsistent - Done showed "0"
          unconditionally while Dormant/Needs Attention only appeared above 0,
          which read as a bug ("completed stays as 0 but dormant disappeared").
          Ian's call: 0 means no show, across the board, in mini mode - big
          mode is the opposite (every subsection always shows its header, see
          Section above), so the two modes intentionally behave differently. */}
      <div className={tinyRow}>
        {/* 2026-07-31, per Ian: "break icon should be in mini mode and have
            a similar color change correspondence where it starts green if
            closer to fresh start and changes color closer to necessary
            break." Same healthHueColor helper the big-mode gauge's own fill
            uses, applied via inline style (beats tinyStat's own `& strong`
            amber rule on specificity) so both places always agree.
            "away" branch added (2026-08-02) - swaps to IconSleep + "zzz"
            instead of the heartbeat + countdown while Ian's away, same
            condition the big-mode gauge below uses. */}
        {personal_health && (
          <span className={tinyStat}>
            {personal_health.away ? (
              <IconSleep />
            ) : (
              <IconHeartbeat color={healthHueColor(personal_health)} />
            )}{" "}
            <strong style={{ color: healthHueColor(personal_health) }}>
              {personal_health.away
                ? "zzz"
                : personal_health.overdue
                  ? "!"
                  : `${personal_health.minutes_left}m`}
            </strong>
          </span>
        )}
        {totals.active > 0 && (
          <span className={tinyStat}><IconActive /> <strong>{totals.active}</strong></span>
        )}
        {totals.idea > 0 && (
          <span className={tinyStat}><IconIdea /> <strong>{totals.idea}</strong></span>
        )}
        {totals.paused > 0 && (
          <span className={tinyStat}><IconPaused /> <strong>{totals.paused}</strong></span>
        )}
        {totals.backlog > 0 && (
          <span className={tinyStat}><IconBacklog /> <strong>{totals.backlog}</strong></span>
        )}
        {/* 2026-07-31, per Ian: tiny mode's Done pill should show "done in the
            last 2 weeks," not the plain lifetime total - a live snapshot of
            "done right now" barely moves, "done recently" is a real momentum
            signal. Big mode's Done section header shows both (see Section
            below). */}
        {totals.done_recent > 0 && (
          <span className={tinyStat}><IconDone /> <strong>{totals.done_recent}</strong></span>
        )}
        {needs_ian_count > 0 && (
          // Uses needs_ian_count (the real, uncapped total), not
          // needs_attention.items.length - that list is capped at
          // NEEDS_ATTENTION_LIMIT (8) for display, so it'd undercount once
          // there are more than 8 open items.
          <span className={tinyStatWarn}><IconWarning /> <strong>{needs_ian_count}</strong></span>
        )}
        {sections && sections.dormant && sections.dormant.total > 0 && (
          <span className={tinyStatWarn}><IconDormant /> <strong>{sections.dormant.total}</strong></span>
        )}
        {/* Bin pill (2026-08-04) - plain tinyStat, not tinyStatWarn: being in
            the bin isn't a warning state the way Dormant/Needs Attention are,
            just an inactive one (same reasoning as IconBin's own color). */}
        {sections && sections.bin && sections.bin.total > 0 && (
          <span className={tinyStat}><IconBin /> <strong>{sections.bin.total}</strong></span>
        )}
      </div>

      <div className={`expand ${expandWrap}`}>
        <div className={expandInner}>
          {hasResets && (
            <div className={resetsSection}>
              {/* onClick locked to overdue-only (2026-08-02), per Ian:
                  "clicking the timer should only reset it to 60 if its
                  zero, it needs to stay in place after counting down."
                  Previously always-clickable, which is what made the
                  UTC/local timestamp bug above so easy to trigger
                  repeatedly by accident. ResetGauge only adds the
                  clickable-cursor/hover-tint treatment when onClick is
                  truthy, so passing undefined while still counting down
                  also makes it visually non-interactive, not just
                  functionally inert. */}
              {/* "away" branch added (2026-08-02), per Ian: "if there is
                  idle or long periods where I am away, can we change the
                  icon to a little z's or sleeping... I don't want it to be
                  in the 'needs a break' when I just am inactive or away.
                  Then auto start the 60m timer when I start working... on
                  Claude again." status_summary.py's load_personal_health
                  now detects real OS idle time (macOS ioreg, best-effort -
                  see its own comment), freezes the countdown while away
                  (overdue always false while away, forced server-side), and
                  auto-resets last_break_at the moment activity resumes -
                  this just swaps the icon/color to match that state. */}
              {/* staleText shortened + moved inline (2026-08-04), per Ian:
                  the old "overdue — take a break (click to reset)" wrapped
                  to two lines inside resetBarCol's fixed 150px width, making
                  this gauge visibly taller than SESSION underneath it -
                  uneven spacing between them. First pass just shortened the
                  text; Ian's follow-up asked to keep every gauge's spacing
                  identical regardless of state, so ResetGauge now renders
                  this inline next to valueText instead of on its own line
                  (see ResetGauge's own comment) - "reset" here reads as
                  "· reset" right after the bold "overdue," and the whole row
                  already has a pointer cursor + hover tint from onClick
                  being set, so no need to spell out "click to." */}
              {personal_health && (
                <ResetGauge
                  label={personal_health.label}
                  valueText={formatHealthGauge(personal_health)}
                  remainingFraction={1 - personal_health.elapsed_fraction}
                  stale={personal_health.overdue}
                  staleText="reset"
                  onClick={personal_health.overdue ? resetHealthTimer : undefined}
                  // Color fix (2026-08-04), per Ian: "the lifelines here for
                  // break in mini mode and last break need to align." This
                  // icon used to render at its default static amber
                  // regardless of urgency, while the mini-mode pill right
                  // above it colors the same heartbeat via healthHueColor's
                  // green->red sweep - same glyph, two different colors, so
                  // they never visually matched. Passing the same helper
                  // here keeps them identical always.
                  icon={
                    personal_health.away ? (
                      <IconSleep />
                    ) : (
                      <IconHeartbeat color={healthHueColor(personal_health)} />
                    )
                  }
                />
              )}
              {session_reset && (
                <ResetGauge
                  label={session_reset.label}
                  valueText={formatSessionReset(session_reset)}
                  remainingFraction={1 - session_reset.elapsed_fraction}
                  stale={session_reset.already_passed}
                  icon={<IconSession />}
                />
              )}
              {usage_resets &&
                usage_resets.map((reset) => (
                  <ResetGauge
                    key={reset.label}
                    label={reset.label}
                    valueText={formatResetCountdown(reset.days_left, reset.hours_left)}
                    remainingFraction={1 - (reset.elapsed_fraction ?? 0)}
                    icon={<IconUsage />}
                  />
                ))}
            </div>
          )}

          {most_recent_project && (
            <div className={recent}>
              Last touched: {most_recent_project.name} ({formatHoursAgo(most_recent_project.hours_ago)})
            </div>
          )}

          <div className={sectionsWrap}>
            <DailyGoals dailyGoal={daily_goal} />
            <Section statusKey="active" section={sections && sections.active} collapsible />
            <Section statusKey="idea" section={sections && sections.idea} collapsible />
            <Section statusKey="paused" section={sections && sections.paused} collapsible />
            <Section statusKey="backlog" section={sections && sections.backlog} collapsible />
            <Section
              statusKey="done"
              section={sections && sections.done}
              collapsible
              recentCount={totals.done_recent}
            />
            <Section statusKey="dormant" section={sections && sections.dormant} collapsible />
            <Section statusKey="bin" section={sections && sections.bin} collapsible />
          </div>

          <div className={sectionsWrap}>
            <NeedsAttention needsAttention={needs_attention} needsIanCount={needs_ian_count} />
          </div>
        </div>
      </div>
      </div>
      {/* Tray always rendered now (2026-08-04), not gated by
          `cardExpanded &&` - see its own comment for why: gating the
          mount/unmount meant it popped in AFTER the card had already
          opened (its own separate spin animation) and vanished instantly
          with no collapse animation at all on the way out, which is what
          read as "lingering"/desynced from the rest of big mode. It's
          always in the DOM now; its own visibility is driven purely by
          cardOuter's `is-expanded` class via CSS, so it opens and closes
          in the exact same instant and over the exact same transition as
          everything else in `.expand`. */}
      <div className={trayColumn}>
        <Tray id="skills" accentColor={STATUS_RED} label="SKILL TRAY" count={skills.length}>
          <HexGrid
            items={skills}
            accentColor={STATUS_RED}
            fillPredicate={(s) => s.call_count > 0}
            renderOverlayBody={renderSkillOverlayBody}
          />
        </Tray>
        <Tray id="scripts" accentColor={STATUS_BLUE} label="SCRIPT TRAY" count={scripts ? scripts.length : 0}>
          <HexGrid
            items={scripts || []}
            accentColor={STATUS_BLUE}
            fillPredicate={() => true}
            renderOverlayBody={renderScriptOverlayBody}
          />
        </Tray>
        <Tray id="reports" accentColor={STATUS_PURPLE} label="REPORTS TRAY" count={reportsPillLabel(reports)}>
          <HexGrid
            items={reportsItems(reports)}
            accentColor={STATUS_PURPLE}
            fillPredicate={(item) => !item.viewed}
            renderOverlayBody={renderReportOverlayBody}
            onTileSelect={markReportViewed}
            serpentine
          />
        </Tray>
      </div>
    </div>
  )
}
