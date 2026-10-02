# Unified UI v2 implementation review

2026-10-02. Local implementation only; no push, PR, installation, deployment, or Windows/Electron execution.

## Baseline and design

- Branch: `ui/unified-v2-cloud`, isolated worktree `/workspace/osulyrics-ui-v2`.
- Fixed parent: `eb6a0d879c4f9893e7dedc51d95727de8d0d1a35`; its only parent is recording-continuity fix `4b5d49b57db0bbc44b1bce61ca48680a7f301562`.
- Package version remains the baseline's 0.4.12. The reported installed Windows 0.4.14 was not opened or inspected; this is source-level integration, not a rebuilt 0.4.14 release.
- Design input: private Library `libfile_1c0e669bf2148191884ecdd54a1e9c27`, `osu-lyrics-ui-v2-implementation-input.zip`, 1,577,008 bytes.
- Actual downloaded SHA-256: `9824dc145d805362f51f5cbcbfeff4fc90c47477139efd856241b7a36bef4b65`; package verifier: 50/50 files.
- Read START-HERE, implementation contract, function mapping, tokens, and review resolution. Viewed all six PNGs before implementation. A graphite/pink direction; B is not exposed as a new setting.

## Implementation

The main page, three appearance categories and four-item candidate page share the 44px header. Appearance and Back share one action slot. Named preset samples expose selection without changing their persisted visual keys. Recovery highlights the existing refresh or search action according to existing status. The status/detail text still comes from the service. No generic failure is relabeled as an offline/network failure: the service does not currently expose a structured network cause suitable for the special network-only design example.

Lyrics always reserve 64px on the left and 16px on the right. The persistent orb has a 44px target, 32px visible circle, center at lyric origin +(34,22), and an 8px target-to-text gap. Material backgrounds now follow the existing theme/color/opacity values continuously rather than only during editing. No saved appearance value or preset definition changes.

The host UI timer uses a linear 167ms full-opacity span. Reversal starts at the current sampled opacity with proportional remaining time. During the transition the panel rectangle, lyric frame and orb stay fixed. The final collapsed host frame still contracts to the lyric or existing 56px icon-only window; screen anchors are preserved away from screen-clamping edges. Reduced-motion rendering immediately selects the target opacity. The host's timer still runs for at most 167ms under reduced motion, but produces no visible scaling/travel/fade; host-frame contraction and real platform preference propagation need Windows verification. Hiding cancels animation and removes host hit testing before hiding the window; the renderer also becomes hidden/inert immediately on the Hide action.

## Work ledger — implementation and verification cycle

| Work area | Actual work and evidence |
|---|---|
| Authorized design delivery | Current Library skill and materialization instructions read. Signed-transfer helper failed with a network tunnel 403, including its bounded permission retry; fresh preparation still returned the same transport. Library read could not expose archive content. Authorized attachment download of the resolved file succeeded; current helper applied Library identity/version metadata. No guessed URL or permission bypass. |
| Source isolation | Cloud source main remained clean at e9effb0; separate worktree created from fixed repair commit, then fast-forwarded to eb6a0d8 before edits. |
| Local guidance | `/workspace/.agents` empty; repository has no AGENTS.md or `.agents/skills` at this baseline. |
| Design fidelity | Six PNGs inspected; token dimensions/colors and source manifest checked. Actual Chromium screenshots inspected after implementation. |
| Main page/header | Unified 44px header, no duplicate Appearance/Back control, title/progress/status/actions/footer rendered at reference and compact sizes. |
| Full appearance controls | Basic/colors/typography retained; four named presets, selected check, plain-background disabled reason, current translation label. |
| Search and candidates | Unicode query forwarding, inline search, 4/4/1 pagination and candidate ID selection checked in browser. Fixed provider `q` contract remains in unchanged service. |
| Import/edit/offset | Existing API calls retained; browser forwards import, edit, −500/+500; existing asynchronous import identity tests pass. |
| Recording/time isolation | Playback clock, clock sync, osu normalization, lyrics service, provider client, presets, settings persistence and preload unchanged. Protected main poll/import and renderer state callbacks compared to base. |
| Presence/anchors | Renderer bounds identical before/mid/after fade; orb-only state and 620px text column checked. Pure geometry tests cover above/below and icon-only screen coordinates. |
| Motion/cancellation | Actual main function bodies run in a Node VM with fake window/timer only: 83ms reverse, repeated reverse and hide cancellation. No Electron module or IPC invocation. |
| Drag/resize/lock | Browser pointer gestures verify orb movement forwarding without click toggle, panel edge resize start/end, locked drag rejection and reachable orb. Host movement itself is not exercised. |
| Typography/long lines | Actual browser font rendering and measurement callback; test API double responds to measured lyric height. Long title truncation, wrapped lyric and translation screenshots inspected. |
| Responsive settings | Browser bounds checks at 500×370, 560×420, 720×420, 1200×600; candidate page at 500. |
| Accessibility/presence | Collapsed panel inert/hidden, orb accessible label and expanded state, immediate hidden body/inert, reduced-motion media emulation tested. |
| Material stress | Nine screenshots: clear/sakura/focus × dark/light/checker background. Low-contrast examples deliberately retained. |
| Regressions | Baseline 101/101; final 103/103 (two obsolete movement-animation tests consolidated, three UI-timer tests added); 46 browser checks, zero renderer exceptions. Syntax and git whitespace checks pass. |
| Delivery/reversibility | One local implementation commit plus reproducible review script, patch, Git bundle, screenshot gallery, logs and acceptance boundary. No remote writes. |

## Reproduction

Pure regressions, with real Electron/network/process launches blocked by the existing guard:

```sh
node --require ./tests/helpers/pure-node-test-guard.cjs --test tests/*.test.cjs
```

Browser review requires an existing `playwright` module and Chromium. This workspace already provided both; no app dependency was added. The script serves production UI files on a temporary loopback HTTP server with an in-memory API double, then closes both browser and server. File navigation is blocked by the browser policy here, so normal loopback serving was used.

```sh
node scripts/review-ui-v2.cjs /workspace/ui-v2-evidence
```

The output contains 24 real Chromium PNGs, `browser-results.json` and Node logs. `index.html` is a local evidence gallery generated for this delivery. These screenshots are not Windows screenshots and are not stills from an Electron animation recording.

## Remaining acceptance boundaries

- No Windows Electron composition, real IPC, hit-test forwarding, DPI/multi-monitor movement, OS reduced-motion propagation, native dialogs/editor/tosu, installed build or real game playback test.
- Browser checks use API doubles. Actual host transition function tests use deterministic fake timers, not OS animation timing. Screenshots at specified opacity frames prove renderer geometry only.
- Existing edge fitting/clamping behavior remains: opening where no side has room may reposition lyrics; off-screen icon recovery clamps to the display. Do not claim invariant anchors for impossible/off-screen geometry.
- Bright-background sakura translation remains a known contrast risk (design's basic-fill estimate 2.26:1). No all-background or whole-app accessibility compliance claim. High-contrast settings are not applied automatically.
- Network-specific import priority is not invented without an authoritative error cause; generic failures retain actual details and the existing refresh action.
- Figma remains unauthenticated and untouched.

## Minimal later integration

The implementation commit is based on eb6a0d8 and should be applied only to a branch containing both repair commits (or their reviewed equivalent). Keep `src/lyrics-service.cjs`'s `{q: query}` patch and its tests. UI changes touch `src/ui/combined.{html,css,js}`, `src/combined-layout.cjs`, and only the UI animation/presence section of `src/main.cjs`; the protected recording poll/import code is unchanged. Resolve any later Windows-side overlap by preserving its reviewed behavior, then rerun the pure suite and separately arrange Windows acceptance. Reverting the single UI commit restores the fixed baseline without removing either repair.
