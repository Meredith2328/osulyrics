# UI v2 evidence correction, 2026-10-03

Independent visual review of frozen commit 35ab42a0 found translation content outside the lyric background in five screenshots: 02-motion-83ms, 03-collapsed and all three 07-compact views. This invalidated the original claim that those screenshots demonstrated the entire lyric surface retaining its geometry.

The browser test double accepted renderer height feedback (115px in the sample), but each later panel-layout injection rebuilt a lyric frame at a fixed 100px. The production host stores height in lyricBounds and reuses it during setPanelOpen/animatedLayout; the independent behavior reviewer found no corresponding production reset. This correction changes only the review script, not application behavior, clock, identity, import, provider search, settings or persisted user data.

The fixture now carries forward its current measured lyric height whenever a panel layout is injected. Every screenshot asserts all visible lyric lines are contained by the surface; open/midfade/collapsed comparison includes the complete lyric surface rectangle, not just the first line and orb. Detailed measured rectangles are written to browser-results.json.

The original frozen ZIP/bundle and its 24 screenshots remain unchanged. New output is a separate `ui-v2-evidence-r2` set, with 24 new screenshots and 70 browser assertions. The increase from 46 to 70 is the 24 per-screenshot containment assertions, not 24 new product features. Independent visual re-review is required before marking this finding closed.

Known contrast risks and absent structured network-error classification remain. Two inherited behavior issues identified by independent review (overlapping same-recording import completion order and delayed drag/resize start cleanup) are separately reported; this evidence-only correction does not alter them. No full independent acceptance or Windows validation is claimed.

No Library upload retried: the supported helper fails during authenticated tools/list before any preparation/create. Inspection was limited to current helper source and configuration-variable presence; no credential file/token was read, no endpoint guessed and no permissions changed. A refreshed authenticated cloud-app session is required before that helper workflow can proceed.
