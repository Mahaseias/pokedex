const CACHE_NAME = "pokedex-kanto-v4";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./vendor/jsqr.min.js",
  "./vendor/tesseract.min.js",
  "./vendor/tesseract.worker.min.js",
  "./vendor/tesseract-core-simd.wasm",
  "./vendor/eng.traineddata.gz",
  "./vendor/por.traineddata.gz",
  "./vendor/ocrad.js",
  "./vendor/fflate.min.js",
  "./vendor/wasmboy.wasm.esm.js",
  "./data/kanto151.sample.json",
  "./litleo.jpg",
  "./clauncher.jpg",
  "./inteleon.jpg",
  "./nickit.jpg",
  "./gholdengo.jpg",
  "./assets/home-hero.jpg",
  "./assets/fonts/press-start-2p.ttf"
];
const SPRITES = Array.from({ length: 151 }, (_, i) => `./assets/sprites/${i + 1}.gif`);
const EXTRA_SPRITES = ["252","255","258","393","495","667","692","818","827","1000"].map(id => `./assets/sprites/${id}.gif`);
const QR_EXAMPLES = ["./data/qr_25.png", "./data/qr_151.png"];
const ASSETS = [...CORE_ASSETS, ...SPRITES, ...EXTRA_SPRITES, ...QR_EXAMPLES];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});







