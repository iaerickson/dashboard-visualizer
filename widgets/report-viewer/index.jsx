import { css } from "uebersicht"
import { THEME } from "../src/theme.config"

// report-viewer — new widget for dashboard-visualizer (2026-08-04), per Ian:
// "I want to work on and run the viewer for our logs and usage summary
// reports so I can be presented with those and have those be more visible
// without having to hunt those down." Reads the same two sources Ian was
// manually opening - ianlogger's latest daily log entry and
// usage-scheduler's latest overnight report - via scripts/report_summary.py
// (read-only, same posture as status_summary.py) and surfaces them as a
// passive, always-on card instead of files he has to go find.
//
// v1 scope, deliberately: passive display only, no click-to-copy actions
// (unlike claudespace-status's rows) - the actual ask here is visibility,
// not another interaction surface. Matches the shared NERV theme so it sits
// next to claudespace-status/tip-of-day without looking like a different
// app; genuinely simpler internals than claudespace-status (no grace-period
// collapse state machine) since there's no dense nested-section tree to
// manage here, just two panels.
//
// SETUP: same one-time symlink pattern as the other two widgets in this
// project - see dashboard-visualizer/README.md.

export const command =
  "python3 '/Users/ianerickson/Desktop/Projects/dashboard-visualizer/scripts/report_summary.py' '/Users/ianerickson/Desktop/ClaudeSpace'"

// Logs/reports update at most a few times a day (nightly + occasional manual
// runs) - no need for claudespace-status's 20s polling. 5 min is plenty
// responsive for "did last night's run finish yet" without polling for no
// reason.
export const refreshFrequency = 300000

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
    return { loading: false, error: "couldn't parse report_summary.py output" }
  }
}

// Position (2026-08-04): bottom-left - claudespace-status owns top-right,
// tip-of-day owns bottom-right, so this is the one open corner that doesn't
// overlap either.
export const className = `
  bottom: 20px;
  left: 40px;
  width: 380px;
`

const NERV_ORANGE = THEME.orange
const NERV_AMBER = THEME.amber
const NERV_BG = THEME.bg
const NERV_LINE = THEME.line
const NERV_TEXT = THEME.text
const NERV_TEXT_DIM = THEME.textDim

const card = css`
  background: ${NERV_BG};
  border: 1px solid ${NERV_LINE};
  color: ${NERV_TEXT};
  font-family: ${THEME.fontFamily};
  padding: 14px 16px;
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
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
  }
  &::after {
    content: "";
    flex: 1;
    height: 1px;
    background: ${NERV_LINE};
    margin-left: 4px;
  }
`

const panel = css`
  margin-bottom: 12px;
  &:last-child {
    margin-bottom: 0;
  }
`

const panelHeader = css`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${NERV_AMBER};
  margin-bottom: 5px;
`

const panelMeta = css`
  font-size: 9px;
  color: ${NERV_TEXT_DIM};
  text-transform: none;
  letter-spacing: 0;
`

const emptyNote = css`
  font-size: 11px;
  color: ${NERV_TEXT_DIM};
  font-style: italic;
`

// Truncate-with-hover-expand (2026-08-04, plain CSS, no JS state) - simplest
// version of the "show a preview, reveal more on hover" pattern already
// used elsewhere in this project. -webkit-line-clamp caps it at 4 lines by
// default; hovering removes the clamp so the full entry reads without
// needing a click. No grace-period timer here (unlike claudespace-status's
// card-level hover) since this is a much smaller, single-purpose reveal -
// if it turns out too flickery in real use, that's the same fix to reach
// for later.
const logText = css`
  font-size: 11px;
  line-height: 1.5;
  color: ${NERV_TEXT};
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;

  &:hover {
    -webkit-line-clamp: unset;
  }
`

const bulletList = css`
  margin: 0;
  padding: 0;
  list-style: none;
`

const bulletItem = css`
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

const attentionBulletItem = css`
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

const moreNote = css`
  font-size: 9px;
  color: ${NERV_TEXT_DIM};
  margin-top: 3px;
`

// Nuggets panel (2026-08-04), per Ian: "make sure it runs with historyman,
// learnerman, cultureman, tutor... it knows to pull context or info from
// nuggets that those things have pulled from in the past." Checked each
// one's own README before building this - none of the four persist any
// content to a file yet (see report_summary.py's own comment on
// load_persona_nuggets for the specifics), so this panel only ever renders
// once `nuggets` actually has entries in it - dormant plumbing today, not a
// placeholder with fake content. Whichever persona(s) start writing to
// their own `log.md` first are the ones that'll show up here first.
const nuggetPersonaLabel = css`
  color: ${NERV_ORANGE};
  font-weight: 600;
  text-transform: capitalize;
  font-size: 10px;
`

const nuggetGroup = css`
  margin-bottom: 6px;
  &:last-child {
    margin-bottom: 0;
  }
`

const nuggetEntry = css`
  font-size: 11px;
  line-height: 1.4;
  color: ${NERV_TEXT_DIM};
  margin-top: 2px;
`

const formatHoursAgo = (hoursAgo) => {
  if (hoursAgo == null) return null
  if (hoursAgo < 1) return `${Math.round(hoursAgo * 60)}m ago`
  if (hoursAgo < 48) return `${Math.round(hoursAgo)}h ago`
  return `${Math.round(hoursAgo / 24)}d ago`
}

// Report titles look like "🌙 Morning Report — for 2026-08-04" - strips the
// leading emoji (rendered separately/redundantly next to a text label would
// look odd here) and keeps the rest as-is.
const cleanReportTitle = (title) => {
  if (!title) return "Latest report"
  return title.replace(/^[^\w]+/, "").trim()
}

// findSection (2026-08-04) - report headings aren't a fixed, guaranteed
// contract (overnight-auto-execute's own report template could evolve, or a
// different scheduled task could generate one with slightly different
// wording) - matches by pattern instead of an exact key, so this doesn't
// silently go blank the moment a heading's exact wording shifts. Skips
// empty sections (a heading with zero bullets that poll, e.g. "Automation
// ideas needing your input" reading "None" some days) rather than showing
// an empty panel.
const findSection = (sections, patterns) => {
  if (!sections) return null
  const keys = Object.keys(sections)
  for (const pattern of patterns) {
    const key = keys.find((k) => pattern.test(k) && sections[k] && sections[k].length > 0)
    if (key) return sections[key]
  }
  return null
}

const BULLET_CAP = 3

export const render = (state) => {
  const { loading, error, log, report, nuggets } = state

  if (loading) {
    return <div className={card}>loading...</div>
  }

  if (error) {
    return (
      <div className={card}>
        <div className={title}>Log &amp; Reports</div>
        <div className={emptyNote}>couldn't read: {error}</div>
      </div>
    )
  }

  const completed = findSection(report?.sections, [/completed/i])
  const needsYou = findSection(report?.sections, [/still needs you/i, /needs you/i])

  return (
    <div className={card}>
      <div className={title}>Log &amp; Reports</div>

      <div className={panel}>
        <div className={panelHeader}>
          <span>Today's Log</span>
          {log && <span className={panelMeta}>{log.date} · {formatHoursAgo(log.hours_ago)}</span>}
        </div>
        {log ? (
          <div className={logText}>{log.text}</div>
        ) : (
          <div className={emptyNote}>no ianlogger entry yet</div>
        )}
      </div>

      <div className={panel}>
        <div className={panelHeader}>
          <span>{report ? cleanReportTitle(report.title) : "Latest Report"}</span>
          {report && <span className={panelMeta}>{formatHoursAgo(report.hours_ago)}</span>}
        </div>
        {report ? (
          <>
            {completed && (
              <ul className={bulletList}>
                {completed.slice(0, BULLET_CAP).map((item, i) => (
                  <li className={bulletItem} key={i}>{item}</li>
                ))}
              </ul>
            )}
            {completed && completed.length > BULLET_CAP && (
              <div className={moreNote}>+{completed.length - BULLET_CAP} more completed</div>
            )}
            {needsYou && (
              <ul className={bulletList} style={{ marginTop: completed ? 8 : 0 }}>
                {needsYou.slice(0, BULLET_CAP).map((item, i) => (
                  <li className={attentionBulletItem} key={i}>{item}</li>
                ))}
              </ul>
            )}
            {!completed && !needsYou && <div className={emptyNote}>nothing to report</div>}
          </>
        ) : (
          <div className={emptyNote}>no usage-scheduler report yet</div>
        )}
      </div>

      {nuggets && nuggets.length > 0 && (
        <div className={panel}>
          <div className={panelHeader}>
            <span>Recent Nuggets</span>
          </div>
          {nuggets.map((n) => (
            <div className={nuggetGroup} key={n.persona}>
              <span className={nuggetPersonaLabel}>{n.persona}</span>
              {n.entries.slice(0, 1).map((entry, i) => (
                <div className={nuggetEntry} key={i}>{entry}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
