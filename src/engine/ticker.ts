// A steady timer for the scheduler. A Worker's setInterval is not throttled when the page is
// busy (React re-renders) or in the background the way a main-thread one is, which matters for a
// lookahead scheduler. Falls back to the main thread if Workers are unavailable.
export function startTicker(cb: () => void, ms: number): () => void {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${ms})`], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onmessage = cb;
    return () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = window.setInterval(cb, ms);
    return () => window.clearInterval(id);
  }
}
