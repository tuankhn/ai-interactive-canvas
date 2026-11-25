/**
 * Bộ định tuyến API & WebSocket tự động cho chế độ tách rời Frontend (GitHub Pages .github.io)
 * và Backend FastAPI (Render / Hugging Face Spaces / Cloud).
 * - Khi chạy local (127.0.0.1 / localhost) hoặc cùng domain với FastAPI: giữ nguyên đường dẫn gốc ''.
 * - Khi chạy trên *.github.io (hoặc khi người dùng cấu hình ?api=... / localStorage):
 *   tự động nối mọi lời gọi fetch('/api/...') và WebSocket('/ws/...') về máy chủ Backend.
 */
(function initRuntimeApiBridge() {
  const STORAGE_KEY = 'ai-canvas:api-base:v1';

  function sanitizeBaseUrl(raw) {
    const trimmed = String(raw || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
  }

  let savedBase = '';
  try {
    const params = new URLSearchParams(window.location.search || '');
    const fromQuery = params.get('api') || params.get('backend');
    if (fromQuery !== null) {
      const cleaned = sanitizeBaseUrl(fromQuery);
      if (cleaned) {
        localStorage.setItem(STORAGE_KEY, cleaned);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    savedBase = sanitizeBaseUrl(localStorage.getItem(STORAGE_KEY) || '');
  } catch {
    savedBase = '';
  }

  const host = (window.location.hostname || '').toLowerCase();
  const isStaticPagesHost =
    host.endsWith('.github.io') ||
    host.endsWith('.pages.dev') ||
    host.endsWith('.netlify.app') ||
    host.endsWith('.vercel.app');

  const defaultCloudBase = sanitizeBaseUrl(window.AI_CANVAS_DEFAULT_API_BASE || '');
  const activeApiBase = savedBase || (isStaticPagesHost ? defaultCloudBase : '');

  window.__AI_CANVAS_API_BASE__ = activeApiBase;
  window.__AI_CANVAS_IS_STATIC_HOST__ = isStaticPagesHost;

  window.getAiCanvasApiBase = function getAiCanvasApiBase() {
    return window.__AI_CANVAS_API_BASE__ || '';
  };

  window.setAiCanvasApiBase = function setAiCanvasApiBase(nextUrl) {
    const cleaned = sanitizeBaseUrl(nextUrl);
    try {
      if (cleaned) {
        localStorage.setItem(STORAGE_KEY, cleaned);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore storage quota errors
    }
    window.__AI_CANVAS_API_BASE__ = cleaned || (isStaticPagesHost ? defaultCloudBase : '');
    return window.__AI_CANVAS_API_BASE__;
  };

  function shouldRewritePath(pathname) {
    return (
      pathname.startsWith('/api/') ||
      pathname === '/health' ||
      pathname.startsWith('/uploads/')
    );
  }

  function rewriteHttpUrl(rawUrl) {
    const base = window.__AI_CANVAS_API_BASE__;
    if (!base || typeof rawUrl !== 'string') return rawUrl;
    if (rawUrl.startsWith('/')) {
      return shouldRewritePath(rawUrl) ? `${base}${rawUrl}` : rawUrl;
    }
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      if (parsed.origin === window.location.origin && shouldRewritePath(parsed.pathname)) {
        return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      // Ignore malformed URLs
    }
    return rawUrl;
  }

  // Bọc window.fetch để tự động chuyển hướng /api/... sang Backend Cloud khi chạy trên GitHub Pages
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input, init) {
    const base = window.__AI_CANVAS_API_BASE__;
    if (!base) {
      return nativeFetch(input, init);
    }
    if (typeof input === 'string') {
      return nativeFetch(rewriteHttpUrl(input), init);
    }
    if (input instanceof URL) {
      return nativeFetch(rewriteHttpUrl(input.toString()), init);
    }
    if (typeof Request !== 'undefined' && input instanceof Request) {
      const nextUrl = rewriteHttpUrl(input.url);
      if (nextUrl !== input.url) {
        return nativeFetch(new Request(nextUrl, input), init);
      }
    }
    return nativeFetch(input, init);
  };

  // Bọc window.WebSocket để đồng bộ thời gian thực qua WSS của Backend Cloud
  const NativeWebSocket = window.WebSocket;
  if (typeof NativeWebSocket === 'function') {
    const PatchedWebSocket = function PatchedWebSocket(url, protocols) {
      let finalUrl = url;
      const base = window.__AI_CANVAS_API_BASE__;
      if (base && typeof url === 'string') {
        try {
          const parsedWs = new URL(url, window.location.origin);
          const apiParsed = new URL(base);
          if (parsedWs.host === window.location.host && parsedWs.pathname.startsWith('/ws/')) {
            const wsProto = apiParsed.protocol === 'https:' ? 'wss:' : 'ws:';
            finalUrl = `${wsProto}//${apiParsed.host}${parsedWs.pathname}${parsedWs.search}`;
          }
        } catch {
          // Fallback giữ nguyên URL gốc
        }
      }
      return protocols !== undefined
        ? new NativeWebSocket(finalUrl, protocols)
        : new NativeWebSocket(finalUrl);
    };
    PatchedWebSocket.prototype = NativeWebSocket.prototype;
    PatchedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
    PatchedWebSocket.OPEN = NativeWebSocket.OPEN;
    PatchedWebSocket.CLOSING = NativeWebSocket.CLOSING;
    PatchedWebSocket.CLOSED = NativeWebSocket.CLOSED;
    window.WebSocket = PatchedWebSocket;
  }
})();
