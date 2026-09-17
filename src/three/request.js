// @ts-check
import { boundedBytes } from "./height-tiles.js";

export class DataHTTPError extends Error {
  /** @param {Response} response */
  constructor(response) {
    super(`Building data unavailable (${response.status})`);
    this.status = response.status;
    const value = response.headers.get("retry-after");
    this.retryAfter = value === null ? 0 : /^\d+(\.\d+)?$/.test(value)
      ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now()) || 0;
  }
}

/** @param {number} milliseconds @param {AbortSignal | undefined} signal */
function pause(milliseconds, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve(undefined);
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Bounded retries include response-body reads, not just response headers.
 * @param {string | URL} url
 * @param {{ signal?: AbortSignal, maximum?: number, timeout?: number, retries?: number, delay?: number, onAttempt?: () => void }} [options]
 * @returns {Promise<ArrayBuffer>}
 */
export async function requestBytes(url, {
  signal, maximum = 8 * 1048576, timeout = 15000, retries = 2, delay = 500, onAttempt,
} = {}) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("Building request timed out", "TimeoutError")), timeout);
    let wait = 0;
    try {
      onAttempt?.();
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const error = new DataHTTPError(response);
        await response.body?.cancel();
        throw error;
      }
      return await boundedBytes(response, maximum, controller.signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (controller.signal.aborted) error = controller.signal.reason;
      const transient = error instanceof DataHTTPError
        ? [408, 429, 500, 502, 503, 504].includes(error.status)
        : error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError");
      // Longer Retry-After values leave recovery to the visible Retry control.
      if (!transient || attempt >= retries || (error instanceof DataHTTPError && error.retryAfter > 5000)) throw error;
      wait = Math.max(error instanceof DataHTTPError ? error.retryAfter : 0,
        Math.min(5000, delay * 2 ** attempt * (1 + Math.random() * 0.25)));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
    await pause(wait, signal);
  }
}
