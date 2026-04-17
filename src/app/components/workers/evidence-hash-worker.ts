// E-H6: offload SHA-256 manifest compute to a worker
/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

self.addEventListener("message", async (ev) => {
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
