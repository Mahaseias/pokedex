/* global jsQR */

const state = {
  pokedex: [],
  types: new Set(),
  tags: new Set(),
  roms: [],
  stream: null,
  scanning: false,
  emuReady: false,
  WasmBoy: null,
  lastRomBuffer: null,
  ocrWorker: null,
};

function $(id){ return document.getElementById(id); }

function setRoute(route){
  const views = ["home","menu","who","scan","emu"];
  for (const v of views){
    const el = $(`view-${v}`);
    el.classList.toggle("hidden", v !== route);
  }
  document.body.dataset.route = route;
  for (const btn of document.querySelectorAll(".tab")){
    btn.classList.toggle("active", btn.dataset.route === route);
  }
  history.replaceState({}, "", `#${route}`);
}

function badge(text){ return `<span class="badge">${escapeHtml(text)}</span>`; }
function spriteUrl(id){ return `./assets/sprites/${Number(id)}.gif`; }

function normalizeName(s){
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const TYPE_PT = {
  Grass: "Grama",
  Poison: "Veneno",
  Fire: "Fogo",
  Water: "Água",
  Normal: "Normal",
  Flying: "Voador",
  Electric: "Elétrico",
  Psychic: "Psíquico",
  Ice: "Gelo",
  Rock: "Pedra",
  Ground: "Terra",
  Fighting: "Lutador",
  Bug: "Inseto",
  Ghost: "Fantasma",
  Dragon: "Dragão",
  Steel: "Aço",
  Fairy: "Fada"
};
function typeLabel(t){ return TYPE_PT[t] || t; }

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}

async function loadData(){
  const res = await fetch("./data/kanto151.sample.json");
  const data = await res.json();
  state.pokedex = data;

  state.types = new Set();
  state.tags  = new Set();

  for (const p of state.pokedex){
    (p.types||[]).forEach(t => state.types.add(t));
    (p.tags||[]).forEach(t => state.tags.add(t));
  }

  populateSelect("f-type", Array.from(state.types).sort());
  populateSelect("f-tag", Array.from(state.tags).sort());

  renderWho();
}

function populateSelect(id, values){
  const sel = $(id);
  const keepFirst = sel.querySelector("option");
  sel.innerHTML = "";
  sel.appendChild(keepFirst);
  for (const v of values){
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
}

function fallbackMoves(p){
  const type = (p.types||[])[0] || "Normal";
  const base = {
    Fire: ["Brasas", "Lança-chamas", "Espiral de Fogo", "Onda de Calor"],
    Water: ["Jato de Água", "Bolha", "Surfar", "Hidro Bomba"],
    Grass: ["Chicote de Vinha", "Folha Navalha", "Mega Dreno", "Raio Solar"],
    Electric: ["Choque do Trovão", "Faísca", "Raio", "Trovão"],
    Psychic: ["Confusão", "Raio Psíquico", "Psíquico", "Premonição"],
    Ice: ["Neve em Pó", "Raio de Gelo", "Vento Congelante", "Nevasca"],
    Rock: ["Arremesso de Rocha", "Deslize de Pedras", "Poder Ancestral", "Lâmina de Pedra"],
    Ground: ["Lama", "Pisotear", "Cavar", "Terremoto"],
    Fighting: ["Golpe de Karatê", "Quebra Tijolo", "Cruz Chop", "Combate Fechado"],
    Poison: ["Picada Venenosa", "Lodo", "Bomba de Lodo", "Tóxico"],
    Bug: ["Corte de Fúria", "Inseticida", "Tesoura X", "Vento Prateado"],
    Flying: ["Rajada de Vento", "Ataque de Asa", "Golpe Aéreo", "Lâmina de Ar"],
    Dragon: ["Sopro do Dragão", "Cauda do Dragão", "Garra do Dragão", "Fúria do Dragão"],
    Ghost: ["Língua", "Soco Sombrio", "Bola Sombria", "Assombrar"],
    Fairy: ["Voz Encantada", "Beijo Drenante", "Jogo Duro", "Rajada Lunar"],
    Steel: ["Garra de Metal", "Disparo Espelhado", "Canhão Flash", "Cabeçada de Ferro"],
    Normal: ["Investida", "Ataque Rápido", "Cabeçada", "Hiper Raio"]
  };
  return base[type] || base.Normal;
}

function fallbackAbilities(p){
  const type = (p.types||[])[0] || "Normal";
  const base = {
    Fire: ["Chama", "Fogo Interno"],
    Water: ["Torrent", "Absorver Água"],
    Grass: ["Crescimento", "Clorofila"],
    Electric: ["Estático", "Pára-raios"],
    Psychic: ["Sincronizar", "Foco Interno"],
    Ice: ["Corpo de Gelo", "Manto de Neve"],
    Rock: ["Robusto", "Cabeça de Pedra"],
    Ground: ["Véu de Areia", "Armadura de Batalha"],
    Fighting: ["Guts", "Espírito Vital"],
    Poison: ["Ponto Venenoso", "Corrosão"],
    Bug: ["Enxame", "Pó de Escudo"],
    Flying: ["Olhar Atento", "Asas Livres"],
    Dragon: ["Mudar de Pele", "Multiescala"],
    Ghost: ["Levitação", "Corpo Amaldiçoado"],
    Fairy: ["Charme", "Pixilate"],
    Steel: ["Corpo Puro", "Robusto"],
    Normal: ["Fuga", "Adaptabilidade"]
  };
  return base[type] || base.Normal;
}

function filterList({type, tag, q}){
  const qq = (q||"").trim().toLowerCase();
  return state.pokedex.filter(p => {
    if (type && !(p.types||[]).includes(type)) return false;
    if (tag  && !(p.tags||[]).includes(tag))   return false;
    if (qq){
      const hay = `${p.id} ${p.name}`.toLowerCase();
      if (!hay.includes(qq)) return false;
    }
    return true;
  });
}

/* ---------------------------
   MÓDULO 1 (Pokédex)
---------------------------- */
function renderWho(){
  const type = $("f-type").value;
  const tag  = $("f-tag").value;
  const q    = $("f-q").value;

  const list = filterList({type, tag, q});
  $("who-count").textContent = String(list.length);

  const root = $("who-list");
  root.innerHTML = list.map(p => `
    <div class="item" data-pid="${p.id}">
      <div class="thumb">
        <img src="${spriteUrl(p.id)}" alt="Sprite de ${escapeHtml(p.name)}" loading="lazy" />
        </div>
      <div class="item-main">
        <div><strong>#${p.id.toString().padStart(3,"0")} ${escapeHtml(p.name)}</strong></div>
        <div class="muted small">${(p.types||[]).map(typeLabel).join(" / ")}</div>
      </div>
      <div class="actions">
        <button class="mini" data-view="${p.id}">Ver Pokémon</button>
      </div>
    </div>
  `).join("");

  root.querySelectorAll(".item").forEach(el => {
    const pid = Number(el.dataset.pid);
    const poke = list.find(p => p.id === pid);
    el.addEventListener("click", () => poke && showWhoDetail(poke));
  });
  root.querySelectorAll("button[data-view]").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const pid = Number(btn.dataset.view);
      const poke = list.find(p => p.id === pid);
      if (poke) showWhoDetail(poke);
    });
  });
}

function showWhoDetail(p){
  const abilities = fallbackAbilities(p);
  const moves = fallbackMoves(p);
  const modal = $("who-modal");
  const detail = $("who-detail");
  detail.innerHTML = `
    <div class="modal-card emerald">
      <button class="modal-close" id="who-close">X</button>
      <div class="emerald-left">
        <div class="emerald-id">No.${p.id.toString().padStart(3,"0")}</div>
        <div class="emerald-sprite">
          <img src="${spriteUrl(p.id)}" alt="Sprite de ${escapeHtml(p.name)}" loading="lazy" />
        </div>
        <div class="emerald-name">${escapeHtml(p.name)}</div>
        <div class="emerald-sub">${(p.types||[]).map(typeLabel).join(" / ")}</div>
      </div>
      <div class="emerald-right">
        <div class="emerald-row header">PROFILE</div>
        <div class="emerald-row">TYPE: <span class="pill">${(p.types||[]).map(typeLabel).join(" / ")}</span></div>
        <div class="emerald-row">ABILITY: ${abilities.slice(0,1).map(escapeHtml).join(", ") || "-"}</div>
        <div class="emerald-row">PICKUP: <span class="muted small">Pode pegar itens.</span></div>
        <div class="emerald-row note"><strong>MEMO:</strong> Golpes: ${moves.slice(0,4).map(escapeHtml).join(", ")}</div>
      </div>
    </div>
  `;
  modal.classList.add("open");
  const closeBtn = $("who-close");
  if (closeBtn){
    closeBtn.onclick = () => modal.classList.remove("open");
  }
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("open");
  }, { once:true });
}

/* ---------------------------
   MÓDULO 2 (Scanner QR / Nome)
---------------------------- */
async function startCamera(){
  if (state.stream) return;
  const video = $("video");
  const constraints = { video: { facingMode: "environment" }, audio: false };

  state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = state.stream;
  await video.play();

  $("btn-start").disabled = true;
  $("btn-stop").disabled = false;
  $("btn-ocr").disabled = false;
  $("btn-ocr-capture").disabled = false;
  $("scan-status").textContent = "Câmera ativa. Aponte para o QR Code...";
  state.scanning = true;
  scanLoop();
}

function stopCamera(){
  state.scanning = false;
  if (state.stream){
    for (const t of state.stream.getTracks()) t.stop();
    state.stream = null;
  }
  $("btn-start").disabled = false;
  $("btn-stop").disabled = true;
  $("btn-ocr").disabled = true;
  $("btn-ocr-capture").disabled = true;
  $("scan-status").textContent = "Câmera parada.";
}

function scanLoop(){
  if (!state.scanning) return;

  const video = $("video");
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (video.readyState >= 2){
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });

    if (code && code.data){
      const raw = String(code.data).trim();
      const m = raw.match(/(\d{1,3})/);
      if (m){
        $("scan-id").value = m[1];
        $("scan-status").textContent = `QR lido: ${raw}`;
        stopCamera();
        loadPokemonFromScan();
        return;
      }
      const pokeByName = findPokemon(raw);
      if (pokeByName){
        $("scan-name").value = pokeByName.name;
        $("scan-status").textContent = `QR lido: ${raw}`;
        stopCamera();
        loadPokemonFromScan();
        return;
      }
    }
  }

  requestAnimationFrame(scanLoop);
}

function loadPokemonFromInputs(preferName = false){
  const nameVal = $("scan-name")?.value || "";
  const idVal = $("scan-id")?.value || "";
  const first = preferName ? nameVal : idVal;
  const second = preferName ? idVal : nameVal;
  let p = findPokemon(first);
  if (!p) p = findPokemon(second);
  if (!p) return;
  showWhoDetail(p);
  setRoute("who");
}

function loadPokemonFromScan(){
  loadPokemonFromInputs(false);
}

async function ensureOcr(){
  if (state.ocrWorker) return state.ocrWorker;
  if (!window.Tesseract || !window.Tesseract.createWorker) throw new Error("Tesseract não carregou.");
  const worker = await window.Tesseract.createWorker({
    workerPath: "./vendor/tesseract.worker.min.js",
    corePath: "./vendor/tesseract-core-simd.wasm",
    langPath: "./vendor",
    logger: () => {}
  });
  await worker.load();
  await worker.loadLanguage("eng");
  await worker.initialize("eng");
  state.ocrWorker = worker;
  return worker;
}

function matchNameFromText(text){
  const norm = normalizeName(text);
  const tokens = norm.split(/[^a-z0-9]+/).filter(Boolean);
  for (const tok of tokens){
    const found = state.pokedex.find(p => normalizeName(p.name) === tok);
    if (found) return found;
  }
  for (const p of state.pokedex){
    if (norm.includes(normalizeName(p.name))) return p;
  }
  return null;
}

async function ocrSnapshot(opts = { autoStop: false }){
  try{
    const video = $("video");
    if (!state.stream || video.readyState < 2){
      $("scan-status").textContent = "Abra a câmera antes de usar OCR.";
      return;
    }
    const canvas = $("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const srcW = Math.floor(video.videoWidth * 0.7);
    const srcH = Math.floor(video.videoHeight * 0.22); // faixa ainda menor
    const srcX = Math.floor((video.videoWidth - srcW) / 2);
    const srcY = 0; // topo onde fica o nome
    canvas.width = srcW;
    canvas.height = srcH;
    ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

    // pré-processamento: escala de cinza + threshold simples
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4){
      const g = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      const v = g > 160 ? 255 : 0;
      data[i] = data[i+1] = data[i+2] = v;
    }
    ctx.putImageData(img, 0, 0);

    $("scan-status").textContent = opts.autoStop ? "Foto capturada. Lendo nome..." : "Lendo nome (OCR)...";
    const worker = await ensureOcr();
    const { data: ocrData } = await worker.recognize(canvas);
    const found = matchNameFromText(ocrData.text || "");
    if (found){
      $("scan-name").value = found.name;
      $("scan-status").textContent = `Nome detectado: ${found.name}`;
      showWhoDetail(found);
      setRoute("who");
      if (opts.autoStop) stopCamera();
    } else {
      $("scan-status").textContent = "Não reconheci um nome de Pokémon. Tente aproximar mais.";
    }
  } catch (e){
    console.error(e);
    $("scan-status").textContent = "Erro no OCR. Verifique se a câmera está aberta.";
  }
}
async function captureAndOcr(){
  await ocrSnapshot({ autoStop: true });
}

function findPokemon(val){
  const raw = String(val || "").trim();
  if (!raw) return null;
  const byId = Number(raw);
  if (!Number.isNaN(byId)){
    const found = state.pokedex.find(x => x.id === byId);
    if (found) return found;
  }
  const target = normalizeName(raw);
  return state.pokedex.find(x => normalizeName(x.name) === target) || null;
}

/* ---------------------------
   EMULADOR wasmBoy
---------------------------- */
async function initEmu(){
  if (state.emuReady) return;
  try {
    const mod = await import("./vendor/wasmboy.wasm.esm.js");
    state.WasmBoy = mod.WasmBoy;
    await state.WasmBoy.config({
      headless: false,
      gameboyFrameRate: 60,
      graphicsPixelFormat: "RGBA",
      isGbcEnabled: true,
      html5Canvas: $("emu-canvas"),
      audioBatchProcessing: true,
      allowFetch: false
    });
    await state.WasmBoy.setCanvas($("emu-canvas"));
    state.emuReady = true;
  } catch (e) {
    console.error("Falha ao iniciar wasmBoy", e);
  }
}

async function autoRunRom(arrayBuffer){
  await initEmu();
  if (!state.emuReady || !arrayBuffer) return;
  try {
    await state.WasmBoy.reset();

    const romData = new Uint8Array(arrayBuffer);
    await state.WasmBoy.loadROM(romData);

    await state.WasmBoy.play();
  } catch (e) {
    console.error("Erro ao executar ROM", e);
  }
}

function loadRoms(){
  const raw = localStorage.getItem("roms");
  state.roms = raw ? JSON.parse(raw) : [];
  renderRoms();
  updatePlayButton();
}

function saveRoms(){
  localStorage.setItem("roms", JSON.stringify(state.roms));
}

function renderRoms(){
  const root = $("rom-list");
  if (!state.roms.length){
    root.innerHTML = `<div class="muted">Nenhuma ROM adicionada ainda.</div>`;
    return;
  }
  root.innerHTML = state.roms.map((r, i) => `
    <div class="item">
      <div>
        <div><strong>${escapeHtml(r.name)}</strong></div>
        <div class="muted small">${escapeHtml(r.note || "Arquivo importado (armazenado como metadado).")}</div>
      </div>
      <div class="badges">
        ${badge("GB/GBC (fase 1)")}
        <button class="ghost" data-del="${i}">Remover</button>
      </div>
    </div>
  `).join("");

  root.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.del);
      state.roms.splice(idx, 1);
      saveRoms();
      renderRoms();
      updatePlayButton();
    });
  });
}

async function addRom(){
  const inp = $("rom-file");
  if (!inp.files || !inp.files[0]) return;

  const f = inp.files[0];
  const buf = await f.arrayBuffer();
  let romBuffer = buf;
  let romName = f.name;

  // suporte a zip: tentar extrair primeiro .gb/.gbc/.gba
  if (/\.(zip)$/i.test(f.name)){
    if (window.fflate && fflate.unzipSync){
      try{
        const entries = fflate.unzipSync(new Uint8Array(buf));
        const names = Object.keys(entries);
        const pick = names.find(n => /\.(gbc?|gba)$/i.test(n));
        if (pick){
          romBuffer = entries[pick].buffer;
          romName = pick;
        } else {
          console.warn("ZIP sem ROM .gb/.gbc/.gba");
          $("scan-status").textContent = "ZIP não contém .gb/.gbc/.gba";
        }
      } catch (e){
        console.error("Falha ao ler ZIP", e);
        $("scan-status").textContent = "Falha ao descompactar ZIP";
      }
    }
  }

  state.lastRomBuffer = romBuffer;
  state.roms.push({ name: romName, note: "ROM adicionada (autoexec wasmBoy)." });
  saveRoms();
  renderRoms();
  updatePlayButton();
  autoRunRom(romBuffer);
  inp.value = "";
}

function updatePlayButton(){
  const btn = $("btn-play-rom");
  if (btn){
    btn.disabled = !state.lastRomBuffer;
  }
}

/* ---------------------------
   Boot
---------------------------- */
function wireUI(){
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => setRoute(btn.dataset.route));
  });
  document.querySelectorAll(".burger-float").forEach(btn => {
    btn.addEventListener("click", () => setRoute(btn.dataset.route));
  });
  document.querySelectorAll("[data-goto]").forEach(btn => {
    btn.addEventListener("click", () => setRoute(btn.dataset.goto));
  });

  const toggle = $("menu-toggle-btn");
  if (toggle){
    toggle.addEventListener("click", () => {
      $("menu-grid").classList.toggle("menu-hidden");
    });
  }
  document.querySelectorAll(".mini-card[data-goto]").forEach(card => {
    card.addEventListener("click", () => setRoute(card.dataset.goto));
  });

  $("f-type").addEventListener("change", renderWho);
  $("f-tag").addEventListener("change", renderWho);
  $("f-q").addEventListener("input", renderWho);

  $("btn-start").addEventListener("click", startCamera);
  $("btn-stop").addEventListener("click", stopCamera);
  $("btn-ocr").addEventListener("click", ocrSnapshot);
  $("btn-ocr-capture").addEventListener("click", captureAndOcr);
  $("btn-load").addEventListener("click", () => loadPokemonFromInputs(false));
  $("btn-load-name").addEventListener("click", () => loadPokemonFromInputs(true));
  $("btn-open-dex").addEventListener("click", () => {
    loadPokemonFromInputs(true);
  });

  $("btn-add-rom").addEventListener("click", addRom);
  $("rom-file").addEventListener("change", addRom);
  $("btn-clear-roms").addEventListener("click", () => {
    state.roms = [];
    state.lastRomBuffer = null;
    saveRoms();
    renderRoms();
    updatePlayButton();
  });
  const playBtn = $("btn-play-rom");
  if (playBtn){
    playBtn.addEventListener("click", () => {
      if (state.lastRomBuffer) autoRunRom(state.lastRomBuffer);
    });
  }
}

async function registerSW(){
  if ("serviceWorker" in navigator){
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (e) {
      console.warn("SW não registrado:", e);
    }
  }
}

(async function main(){
  wireUI();

  const initial = (location.hash || "#home").replace("#","");
  setRoute(["home","menu","who","scan","emu"].includes(initial) ? initial : "home");

  await registerSW();
  await loadData();
  loadRoms();
})();

