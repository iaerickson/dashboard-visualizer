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
  // Title is always render()'s first direct child inside the card root,
  // so parentElement is reliably the card itself.
  const cardEl = e.currentTarget.parentElement
  if (cardEl && cardEl._collapseTimer) {
    clearTimeout(cardEl._collapseTimer)
    cardEl._collapseTimer = null
  }
  setExpanded(cardEl, !cardExpanded)
}

export const command =
  "python3 '/Users/ianerickson/Desktop/Projects/dashboard-visualizer/scripts/status_summary.py'"

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
const card = css`
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

  /* Real bug (2026-07-31), per Ian: "navigating items towards the bottom of
     the scroll... quickly go back to mini... shouldn't collapse unless the
     pointer exits the boundary of the big mode dimensions." Pure CSS :hover
     was the trigger here, which is SUPPOSED to only react to the pointer's
     actual screen position relative to this element's rendered box - but
     that's exactly the class of thing that gets flaky around scroll/reflow
     in a WebView (the 280ms exit-delay on expandWrap below was an earlier
     patch for the same symptom, not a full fix). Switched to an explicit,
     deterministic trigger instead: onMouseEnter/onMouseLeave on this card's
     own root element (see render()) toggle a literal is-expanded class via
     classList - real DOM boundary-crossing events, not a CSS pseudo-class
     re-derived every frame, so "collapse only when the pointer truly leaves
     this element's box" is guaranteed by the browser's own event model
     rather than approximated. No Accessibility permission needed for this
     (that concern, noted elsewhere in this file, is about OS-level
     click-to-expand outside the WebView - mouseenter/mouseleave are plain
     in-page DOM events, same category as every other classList toggle
     already used throughout this file). */
  &.is-expanded .expand {
    grid-template-rows: 1fr;
    opacity: 1;
    pointer-events: auto;
    margin-top: 12px;
    transition-delay: 0s;
  }

  /* Click confirmation (2026-07-31) - see copyPrompt()'s comment above for
     why this exists (the composer prefill doesn't survive the folder-trust
     dialog, so this is the real feedback a click happened at all). Plain
     literal class toggled via classList in JS, not an emotion-generated
     name, same "literal class alongside hash" trick as .expand/.nested/
     .detail elsewhere in this file - nested here so Emotion scopes it under
     the card's own hashed class. */
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
// often they are getting run and brief descriptions of what they do...
// maybe when command space goes big mode, a side piece flips open like
// swiss army knife called skills tray." A small vertical tab fixed to the
// card's right edge, visible only in big mode (see render()'s own
// `cardExpanded &&` guard); hovering it flips out a panel listing every
// skill from status_summary.py's `load_skills_catalog`, sorted by call
// count, each with a "last used" caption and a hover-expandable brief
// description - same `detail`/hover-reveal language as every other row in
// this file.
//
// Rendered as a SIBLING of `card` in render(), not a child - `card` has
// its own `overflow: hidden` (needed for the ambient sweep animation and
// its clipped-corner shape), which would clip a panel meant to visually
// escape the card's own bounding box. Both `card` and this end up as
// direct children of Übersicht's own outer widget container (see this
// file's `className` export), so `position: absolute` here sizes/
// positions relative to that same shared box - `right: -27px` reliably
// lands just past the card's own right edge regardless of card's internal
// layout, and the flyout opens back toward the card (`right: 100%`)
// rather than further off toward the screen's own right edge, since the
// widget already sits close to it (`right: 40px` in `className`).
const skillsTabWrap = css`
  position: absolute;
  top: 60px;
  right: -27px;
  z-index: 5;

  &:hover .flyout {
    opacity: 1;
    pointer-events: auto;
    transform: translateX(0);
  }
`

const skillsTabHandle = css`
  width: 26px;
  padding: 10px 4px;
  background: ${NERV_BG};
  border: 1px solid ${NERV_LINE};
  border-left: none;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), 50% 100%, 0 calc(100% - 10px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;

  &:hover {
    background: rgba(255, 107, 26, 0.1);
    border-color: ${NERV_ORANGE};
  }
`

const skillsTabLabel = css`
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 9px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: ${NERV_TEXT_DIM};
`

const skillsTabCount = css`
  font-size: 10px;
  font-weight: 700;
  color: ${NERV_ORANGE};
`

const skillsFlyout = css`
  position: absolute;
  top: 0;
  right: 100%;
  margin-right: 6px;
  width: 260px;
  max-height: 480px;
  overflow-y: auto;
  background: ${NERV_BG};
  border: 1px solid ${NERV_LINE};
  padding: 10px;
  box-shadow: 0 4px 28px rgba(0, 0, 0, 0.5);
  opacity: 0;
  pointer-events: none;
  transform: translateX(6px);
  transition: opacity 0.25s ease, transform 0.25s ease;

  &::-webkit-scrollbar {
    width: 5px;
  }
  &::-webkit-scrollbar-thumb {
    background: ${NERV_LINE};
    border-radius: 2px;
  }
`

const skillsFlyoutHeader = css`
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${NERV_ORANGE};
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid ${NERV_LINE};
`

const skillRow = css`
  display: flex;
  flex-direction: column;
  gap: 0;
  font-size: 11px;
  line-height: 1.4;
  color: ${NERV_TEXT_DIM};
  padding: 4px 4px;
  border-left: 2px solid transparent;
  transition: background 0.2s ease, border-color 0.2s ease;

  &:hover {
    background: color-mix(in srgb, ${STATUS_TEAL} 14%, transparent);
    border-left: 2px solid ${STATUS_TEAL};
  }
  &:hover .detail {
    transition-delay: 260ms;
    grid-template-rows: 1fr;
    opacity: 1;
    pointer-events: auto;
    margin-top: 4px;
  }
`

const skillRowTop = css`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
`

const skillRowName = css`
  color: ${NERV_TEXT};
  font-weight: 600;
`

const skillRowMeta = css`
  font-size: 9px;
  color: ${NERV_TEXT_DIM};
  white-space: nowrap;
  flex-shrink: 0;
`

const formatSkillLastUsed = (hoursAgo) => {
  if (hoursAgo == null) return "never run"
  if (hoursAgo < 1) return "used <1h ago"
  if (hoursAgo < 24) return `used ${Math.round(hoursAgo)}h ago`
  return `used ${Math.round(hoursAgo / 24)}d ago`
}

const SkillRow = ({ skill }) => (
  <div className={skillRow}>
    <div className={skillRowTop}>
      <span className={skillRowName}>{skill.name}</span>
      <span className={skillRowMeta}>
        {skill.call_count > 0 ? `${skill.call_count}× · ` : ""}
        {formatSkillLastUsed(skill.last_called_hours_ago)}
      </span>
    </div>
    {skill.description && (
      <div className={`detail ${detail}`} style={{ borderLeftColor: STATUS_TEAL }}>
        <div className={detailInner}>{skill.description}</div>
      </div>
    )}
  </div>
)

// SkillsTab - see the css comment above (`skillsTabWrap`) for the full
// design rationale, including why this renders as a sibling of `card`.
const SkillsTab = ({ skills }) => {
  if (!skills || skills.length === 0) return null
  const usedCount = skills.filter((s) => s.call_count > 0).length
  return (
    <div className={skillsTabWrap}>
      <div className={skillsTabHandle}>
        <span className={skillsTabCount}>{skills.length}</span>
        <span className={skillsTabLabel}>SKILLS</span>
      </div>
      <div className={`flyout ${skillsFlyout}`}>
        <div className={skillsFlyoutHeader}>
          {skills.length} skills · {usedCount} used
        </div>
        {skills.map((s) => (
          <SkillRow key={s.name} skill={s} />
        ))}
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
  const goals = dailyGoal && dailyGoal.goals ? dailyGoal.goals : []
  if (!dailyGoal || goals.length === 0) return null

  return (
    <div className={collapsibleSection}>
      <div className={sectionHeader}>
        <span className={sectionHeaderLabel}><IconGoal /> Daily Goals</span>
        <span className={sectionHeaderCount}>{goals.length}</span>
      </div>
      <div className={`nested ${nestedList}`}>
        <div className={`${nestedInner} ${scrollList}`}>
          {goals.map((g, i) => (
            <GoalRow key={i} goal={g} completed={dailyGoal.completed} />
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
// Detail panel went through two shapes the same day. First pass used real
// SubFields (one independently-expandable sub-panel each for Summary/
// Currently in/Context), matching ProjectRow's own multi-field detail -
// per Ian's ask: "maybe sub sections can be summary, an explandable read
// out of what section it currently lives in and maybe the previous
// context piece." Walked back after seeing it live: "the style of goals
// explandable still is weird and different than the others... match the
// font and styling of the text of the other expandables so its standard."
// Root issue: GoalRow's OWN row is already AttentionEntryRow's exact
// shape, but its detail panel had switched to ProjectRow's heavier,
// separately-hoverable multi-SubField pattern instead - two different
// rows in this file claiming the same "attentionRow" identity but
// resolving their detail panel two different ways. Reverted to ONE flat
// `detail`/`detailInner` block, exactly like AttentionEntryRow's own -
// `formatGoalDetail` below just joins whichever of detail/current_section/
// context are present into one readable block instead of three separate
// hover targets.
const goalPrompt = (title, detail) =>
  `Help work on today's Commandspace goal: ${title}.` +
  (detail ? ` ${detail}` : "") +
  ` Before starting: read PROCESS.md and PHILOSOPHY.md in this folder for the ` +
  `tracker's conventions.`

const formatGoalDetail = (goal) => {
  const parts = []
  if (goal.detail) parts.push(goal.detail)
  if (goal.current_section) parts.push(`Currently in: ${goal.current_section}.`)
  if (goal.context) parts.push(goal.context)
  return parts.join(" ")
}

// Bullet icon shrunk to 9px (2026-08-04), smaller than the 12px default
// every other row icon in this file uses - per Ian, twice: "the mini goal
// bullets are a nice touche but theyre too big" and then, still not small
// enough after the first pass, "i like the bullet icons make them
// smaller." Deliberately breaks from matching attentionKind's usual
// icon size exactly, since Ian's calling these "bullets" (a lighter,
// decorative marker) rather than a semantic action icon like IconAsk/
// IconBlocked.
const GoalRow = ({ goal, completed }) => {
  const detailText = formatGoalDetail(goal)
  return (
    <div
      className={
        completed
          ? `${attentionRow} ${clickableCursor} ${hoverTint(NERV_ORANGE)} ${goalItemDone}`
          : `${attentionRow} ${clickableCursor} ${hoverTint(NERV_ORANGE)}`
      }
      onClick={(e) => {
        e.stopPropagation()
        copyPrompt(goalPrompt(goal.title, goal.detail), e.currentTarget)
      }}
    >
      <div className={attentionRowTop}>
        <span className={attentionKind}>{completed ? <IconGoalDone size={9} /> : <IconGoal size={9} />}</span>
        <span>{goal.title}</span>
      </div>
      {detailText && (
        <div className={`detail ${detail}`} style={{ borderLeftColor: NERV_ORANGE }}>
          <div className={detailInner}>{detailText}</div>
        </div>
      )}
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
  } = state

  if (loading) {
    return <div className={card}>loading...</div>
  }

  if (error) {
    return (
      <div className={card}>
        <div className={title}>Commandspace</div>
        <div>couldn't read tracker: {error}</div>
      </div>
    )
  }

  const hasResets = (usage_resets && usage_resets.length > 0) || session_reset || personal_health

  return (
    // Plain wrapper div (2026-08-04), not a JSX fragment shorthand -
    // Übersicht's JSX transform errored on the fragment shorthand with
    // "Can't find variable: React" (fragments desugar to React.Fragment, which needs a
    // React global this environment doesn't inject; every other element
    // here compiles to plain function calls that don't need one). An
    // unstyled div is a no-op for layout/positioning purposes - it's
    // `position: static`, so it doesn't become the nearest positioned
    // ancestor for `SkillsTab`'s own `position: absolute` (that's still
    // whatever Übersicht's outer widget container provides, unchanged from
    // before this wrapper existed) - it's only here so `card` and
    // `SkillsTab` can be siblings without a fragment.
    <div>
    <div
      className={cardExpanded ? `${card} is-expanded` : card}
      onMouseEnter={(e) => disarmCollapse(e.currentTarget)}
      onMouseLeave={(e) => armCollapse(e.currentTarget)}
    >
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
    {cardExpanded && <SkillsTab skills={skills} />}
    </div>
  )
}
