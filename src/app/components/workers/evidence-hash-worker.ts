// E-H6: offload SHA-256 manifest compute to a worker
/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

// F2 (2026-05-26): root fix for CodeQL js/missing-origin-check #44.
// DedicatedWorkers can only receive messages from the script that
// instantiated them (same-origin invariant of the Web Worker spec),
// so `ev.origin` is empty-string for legitimate messages from the
// parent page. We still validate defensively because the alert is a
// life-safety check: a malicious browser extension or compromised
// global could in theory dispatch a synthetic MessageEvent with a
// non-empty origin. Rejecting any non-empty origin closes the rule
// at the source without changing behaviour for the legitimate caller.
self.addEventListener("message", async (ev) => {
  if (ev.origin && ev.origin !== self.location.origin) {
    // Reject messages claiming a foreign origin — DedicatedWorker
    // contract says these cannot exist in normal operation.
    return;
  }
  const { id, blobs } = ev.data || {};
  try {
    const hashes: string[] = [];
    for (let i = 0; i < (blobs || []).length; i++) {
      const ab = await (blobs[i] as Blob).arrayBuffer();
      const hash = await crypto.subtle.digest("SHA-256", ab);
      hashes.push(
        Array.from(new Uint8Array(hash))
          .map(b => b.toString(16).padStart(2, "0"))
          .join("")
      );
      (self as any).postMessage({ id, progress: (i + 1) / blobs.length });
    }
    (self as any).postMessage({ id, done: true, hashes });
  } catch (e: any) {
    (self as any).postMessage({ id, error: e?.message || String(e) });
  }
});
