let stylesheet: Promise<void> | undefined;
let fontLink: HTMLLinkElement | undefined;
/** Local unicode subsets: the browser fetches only glyph ranges used by this title. */
export async function ensureTitleFonts(text?: string, signal?: AbortSignal) {
  if (!text?.trim()) return;
  signal?.throwIfAborted();
  stylesheet ??= new Promise<void>((resolve, reject) => {
    const link = document.createElement('link'); fontLink = link;
    const timer = setTimeout(() => { link.remove(); reject(new Error('TITLE_FONT_UNAVAILABLE')); }, 15_000);
    link.rel = 'stylesheet'; link.href = `${import.meta.env.BASE_URL}fonts/titles.css`;
    link.onload = () => { clearTimeout(timer); resolve(); };
    link.onerror = () => { clearTimeout(timer); link.remove(); reject(new Error('TITLE_FONT_UNAVAILABLE')); };
    document.head.append(link);
  }).catch(error => { stylesheet = undefined; throw error; });
  const pendingStylesheet = stylesheet;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    const abort = () => finish(signal?.reason ?? new DOMException('Cancelled','AbortError'));
    const timer = setTimeout(() => finish(new Error('TITLE_FONT_UNAVAILABLE')), 15_000);
    signal?.addEventListener('abort', abort, { once:true });
    pendingStylesheet.then(() => Promise.all([
      document.fonts.load('500 40px "Cormorant Garamond"', text),
      document.fonts.load('500 40px "Noto Serif TC"', text),
    ])).then(() => finish(), () => {
      if (stylesheet === pendingStylesheet) { fontLink?.remove(); stylesheet = undefined; }
      finish(new Error('TITLE_FONT_UNAVAILABLE'));
    });
  });
  signal?.throwIfAborted();
}
