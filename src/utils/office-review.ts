export interface ReviewBinding { id: string; documentKey: string; origin: string }
type Target = { kind: string; page?: number; name?: string; objectType?: string; text?: string;
  boundsUnit?: string; bounds?: { x: number; y: number; width: number; height: number } }

/** Fixed, read-only bridge. URL options never grant document or save permissions. */
export function parseReviewBinding(id: unknown, documentKey: unknown, origin: unknown): ReviewBinding | undefined {
  if (typeof id !== 'string' || !/^[\w-]{16,80}$/.test(id) || typeof documentKey !== 'string' ||
      !/^[\w:.-]{1,120}$/.test(documentKey) || typeof origin !== 'string') return;
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return;
    return { id, documentKey, origin };
  } catch { return; }
}

function read(object: any, method: string) {
  try { return typeof object?.[method] === 'function' ? object[method]() : null }
  catch { return null }
}

/** SDK public getters only, no canvas hit-testing or minified model fields. */
export function readPresentationReview(api: any, types: Record<string, number>): Target | null {
  const index = read(api, 'getCurrentPage');
  if (!Number.isInteger(index) || index < 0) return null;
  const page: Target = { kind: 'slide', page: index + 1 };
  const elements = read(api, 'getSelectedElements');
  if (!Array.isArray(elements)) return page;
  const selected = elements.filter(item => ['Shape', 'Image', 'Table', 'Chart']
    .some(type => types[type] !== undefined && read(item, 'get_ObjectType') === types[type]));
  const count = read(api, 'asc_getSelectedDrawingObjectsCount');
  if (selected.length !== 1 || typeof count === 'number' && count !== 1) return page;
  const element = selected[0];
  const value = read(element, 'get_ObjectValue');
  const kind = ['Shape', 'Image', 'Table', 'Chart'].find(type => types[type] !== undefined && read(element, 'get_ObjectType') === types[type]);
  const position = read(value, 'get_Position');
  const bounds = { x: read(position, 'get_X'), y: read(position, 'get_Y'),
    width: read(value, 'get_Width'), height: read(value, 'get_Height') };
  const name = read(value, 'get_Name');
  const text = read(api, 'asc_GetSelectedText');
  const objectType = kind === 'Image' && read(value, 'get_ShapeProperties') ? 'shape' : kind?.toLowerCase();
  return { ...page, kind: 'object', objectType,
    ...(typeof text === 'string' && text ? { text: text.slice(0, 4000) } : {}),
    ...(typeof name === 'string' ? { name: name.slice(0, 1000) } : {}),
    ...(Object.values(bounds).every(v => typeof v === 'number' && Number.isFinite(v)) ? { bounds, boundsUnit: 'mm' } : {}) };
}

/** Runs inside the local preview application; never exposes the editor API to its parent. */
export function setupOfficeReview(frame: HTMLIFrameElement, binding: ReviewBinding | undefined) {
  const win = frame.contentWindow as any;
  const api = win?.PE?.getController('Main')?.api;
  if (!binding || !api || window.top === window) return { dispose() {}, selectPage(_index: number) {}, setPreviewMode(_active: boolean, _index?: number) {} };
  let subscription: string | null = null;
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let readyTimer: ReturnType<typeof setTimeout>;
  let readyCount = 0;
  let disposed = false;
  // Continuous preview is rendered independently. Never reuse a previously
  // selected native object when the user clicks a different preview page.
  let previewPage: number | null = null;
  let previewMode = false;
  let readingSnapshot = false;
  let lastSignature: string | undefined;
  let pending = false;
  let anchor: { x: number; y: number } | null = null;
  const send = (data: Record<string, unknown>) => {
    if (!disposed) window.top!.postMessage({ ...data, id: binding.id, documentKey: binding.documentKey }, binding.origin);
  };
  const ready = () => {
    send({ type: 'mantis-office-review-ready' });
    if (++readyCount < 15) readyTimer = setTimeout(ready, 1000);
  };
  const snapshot = () => {
    // Public getters may synchronously emit focus callbacks. These are part
    // of this read, not a new user selection; do not re-enter the bridge.
    readingSnapshot = true;
    try {
      return previewMode
        ? previewPage === null ? null : { kind: 'slide', page: previewPage + 1 }
        : readPresentationReview(api, win.Asc?.c_oAscTypeSelectElement || {});
    } finally { readingSnapshot = false; }
  };
  const signature = (target: ReturnType<typeof snapshot>) => JSON.stringify({ target, anchor });
  const change = () => {
    if (!subscription || disposed || readingSnapshot) return;
    if (!pending && signature(snapshot()) === lastSignature) return;
    if (!pending) {
      pending = true;
      send({ type: 'mantis-office-review-selection', watchId: subscription, sequence: ++sequence, pending: true, target: null });
    }
    // A fixed deadline cannot be starved by repeated layout/focus events.
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      pending = false;
      if (subscription && !disposed) {
        const target = snapshot();
        lastSignature = signature(target);
        send({ type: 'mantis-office-review-selection', watchId: subscription, sequence: ++sequence, pending: false, target, anchor });
      }
    }, 140);
  };
  const nativeChange = () => {
    if (readingSnapshot || previewMode) return;
    anchor = null;
    change();
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!subscription || event.button !== 0 || !event.isPrimary) return;
    const rect = frame.getBoundingClientRect();
    const width = window.innerWidth, height = window.innerHeight;
    if (!width || !height || !win.innerWidth || !win.innerHeight) return;
    anchor = {
      x: Math.max(0, Math.min(100, (rect.left + event.clientX * rect.width / win.innerWidth) / width * 100)),
      y: Math.max(0, Math.min(100, (rect.top + event.clientY * rect.height / win.innerHeight) / height * 100)),
    };
    change();
  };
  const editorDocument = frame.contentDocument;
  editorDocument?.addEventListener('pointerup', onPointerUp, true);
  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (event.source !== window.top || event.origin !== binding.origin || !data || data.id !== binding.id) return;
    clearTimeout(readyTimer);
    if (data.type === 'mantis-office-review-watch' && typeof data.watchId === 'string' && data.watchId.length <= 80) {
      if (data.enabled === true) {
        clearTimeout(timer); timer = undefined; pending = false;
        subscription = data.watchId; lastSignature = undefined; change();
      }
      else if (data.enabled === false && subscription === data.watchId) {
        subscription = null; clearTimeout(timer); timer = undefined; pending = false;
      }
    } else if (data.type === 'mantis-office-review-capture' && typeof data.requestId === 'string' && data.requestId.length <= 80) {
      send({ type: 'mantis-office-review-result', requestId: data.requestId, target: snapshot(), anchor });
    }
  };
  window.addEventListener('message', onMessage);
  for (const event of ['asc_onCurrentPage', 'asc_onFocusObject']) api.asc_registerCallback(event, nativeChange);
  ready();
  return {
    selectPage(index: number) { previewMode = true; anchor = null; previewPage = Number.isInteger(index) && index >= 0 ? index : null; change(); },
    setPreviewMode(active: boolean, index?: number) {
      previewMode = active; anchor = null;
      previewPage = active && Number.isInteger(index) && index! >= 0 ? index! : null;
      change();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer); clearTimeout(readyTimer);
      window.removeEventListener('message', onMessage);
      editorDocument?.removeEventListener('pointerup', onPointerUp, true);
      for (const event of ['asc_onCurrentPage', 'asc_onFocusObject']) api.asc_unregisterCallback?.(event, nativeChange);
    },
  };
}
