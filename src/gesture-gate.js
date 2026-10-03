// Renderer-only ownership for the existing untagged drag/resize API.
// A cancelled start holds the gate until its acknowledgement is cleaned up.
(() => {
  function create(api, onEnd = () => {}) {
    let current = null;
    return {
      reserve(kind) {
        if (current) return null;
        const title = kind === 'resize' ? 'Resize' : 'Drag';
        let cancelled = false, settled = false, accepted = false, ended = false;
        const release = () => { if (current === lease) current = null; };
        const end = () => {
          if (!ended && accepted) {
            ended = true;
            api[`overlay${title}End`]();
            onEnd();
          }
          release();
        };
        const lease = {
          async start(payload) {
            try {
              accepted = !!(await api[`overlay${title}Start`](payload));
            } catch {
              // Delivery may have reached the host before the reply failed.
              // No newer request can exist while this lease owns the gate.
              accepted = true;
              cancelled = true;
            }
            settled = true;
            if (cancelled || !accepted) { end(); return false; }
            return true;
          },
          cancel() {
            cancelled = true;
            if (settled) end();
          },
        };
        current = lease;
        return lease;
      },
    };
  }
  const exported = { create };
  if (typeof module !== 'undefined') module.exports = exported;
  if (typeof window !== 'undefined') window.osuGestureGate = exported;
})();
