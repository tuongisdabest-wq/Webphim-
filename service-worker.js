// Service Worker cho KKPhim PWA.
// CHỈ cache "app shell" (index.html, manifest, logo) để mở app nhanh + có màn hình
// khi mất mạng. KHÔNG cache API phim (phimapi.com, tmdb-proxy...) hay video/ảnh
// cross-origin, vì dữ liệu phim thay đổi liên tục — cache nhầm sẽ hiện phim cũ/lỗi.

const CACHE_NAME = 'ktuongfx-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './logo.png'
];

// ----- Install: cache trước app shell. dùng addAll từng file (Promise.allSettled)
// để 1 file lỗi (vd logo.png chưa tồn tại) không làm hỏng cả service worker. -----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(SHELL_FILES.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

// ----- Activate: dọn cache cũ của bản trước (đổi CACHE_NAME khi deploy bản mới). -----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Bỏ qua hoàn toàn mọi request khác origin (API phim, TMDB proxy, ảnh poster,
  // video HLS...) — để trình duyệt tự fetch bình thường, không can thiệp/cache.
  if (url.origin !== self.location.origin) return;

  // Trang HTML (điều hướng) + app.js/style.css: network-first — luôn ưu tiên bản mới nhất
  // khi có mạng, chỉ dùng bản cache khi mất mạng. THÊM app.js/style.css vào đây (trước đây
  // rơi vào nhánh cache-first bên dưới, khiến deploy code mới rồi mà user vẫn bị kẹt xem
  // bản JS/CSS cũ ở lần load đầu, phải load lần 2 mới thấy code mới).
  const isCoreScript = url.pathname.endsWith('/app.js') || url.pathname.endsWith('/style.css');
  if (req.mode === 'navigate' || isCoreScript) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
    );
    return;
  }

  // Static shell còn lại (manifest, logo...): cache-first, tự cập nhật cache nền sau đó.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
