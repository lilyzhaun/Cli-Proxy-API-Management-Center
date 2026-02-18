const APP_VERSION = 'v2';
const STATIC_CACHE_NAME = `cpamc-static-${APP_VERSION}`;
const RUNTIME_CACHE_NAME = `cpamc-runtime-${APP_VERSION}`;
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/pwa-icon.svg',
  '/pwa-192.png',
  '/pwa-512.png',
];

const isCacheableResponse = (response) =>
  Boolean(response) &&
  response.status === 200 &&
  (response.type === 'basic' || response.type === 'cors');

const isStaticAssetRequest = (request) =>
  ['script', 'style', 'image', 'font'].includes(request.destination) ||
  request.url.endsWith('.webmanifest') ||
  request.url.endsWith('.css') ||
  request.url.endsWith('.js');

const networkFirst = async (request, fallbackResponse) => {
  try {
    const networkResponse = await fetch(request);
    if (isCacheableResponse(networkResponse)) {
      const cache = await caches.open(RUNTIME_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    return cached || fallbackResponse;
  }
};

const staleWhileRevalidate = async (request) => {
  const cached = await caches.match(request);
  const updatePromise = fetch(request)
    .then(async (networkResponse) => {
      if (isCacheableResponse(networkResponse)) {
        const cache = await caches.open(RUNTIME_CACHE_NAME);
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => undefined);

  if (cached) {
    return cached;
  }

  if (updatePromise) {
    return updatePromise;
  }

  return fetch(request);
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE_NAME && key !== RUNTIME_CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/v0/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(
        request,
        caches.match('/index.html').then((response) => response || Response.error())
      )
    );
    return;
  }

  if (isStaticAssetRequest(request)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(
    networkFirst(
      request,
      caches.match(request).then((response) => response || Response.error())
    )
  );
});
