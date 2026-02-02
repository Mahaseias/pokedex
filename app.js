/* global jsQR */

const state = {
  pokedex: [],
  types: new Set(),
  tags: new Set(),
  roms: [],
  stream: null,
  scanning: false,
  ocrTimer: null,
  emuReady: false,
  WasmBoy: null,
  lastRomBuffer: null,
  ocrWorker: null,
  joypadState: {
    up:false, down:false, left:false, right:false,
    A:false, B:false, START:false, SELECT:false
  },
  battleTimer: null,
  speech: {
    currentUtter: null
  }
};

// carregamento de vozes TTS
let loadedVoices = [];
function loadVoices(){
  loadedVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}
if ("speechSynthesis" in window){
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}

// Mapeia data-key -> botões lógicos do Game Boy
const PAD_LOGICAL = {
  up: "UP",
  down: "DOWN",
  left: "LEFT",
  right: "RIGHT",
  a: "A",
  b: "B",
  start: "START",
  select: "SELECT"
};
// Fallback teclado caso a API do wasmBoy não esteja disponível
const PAD_KEYBOARD = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  a: "z",
  b: "x",
  start: "Enter",
  select: "Shift"
};
const PAD_ALT_KEYS = {
  a: ["z", "KeyZ"],
  b: ["x", "KeyX"],
  start: ["Enter", "Return"],
  select: ["Shift", "Backspace", "Space"]
};

function $(id){ return document.getElementById(id); }

function setRoute(route){
  const views = ["home","menu","who","scan","emu","battle"];
  for (const v of views){
    const el = $(`view-${v}`);
    el.classList.toggle("hidden", v !== route);
  }
  document.body.dataset.route = route;
  for (const btn of document.querySelectorAll(".tab")){
    btn.classList.toggle("active", btn.dataset.route === route);
  }
  history.replaceState({}, "", `#${route}`);

  // abrir menu expandido por padrão
  if (route === "menu"){
    const grid = $("menu-grid");
    if (grid) grid.classList.remove("menu-hidden");
  }
}

function badge(text){ return `<span class="badge">${escapeHtml(text)}</span>`; }
function spriteUrl(id){ return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${Number(id)}.png`; }
function officialArt(id){ return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`; }
function getSprite(p){ return officialArt(p.id); }
function getFallbackSprite(p){ return spriteUrl(p.id); }

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

// Regiões e evolução extra para alguns cards novos
const EXTRA_INFO = {
  667: { region: "Kalos", next: { name: "Pyroar", level: 35 } },
  692: { region: "Kalos", next: { name: "Clawitzer", level: 37 } },
  818: { region: "Galar", final: true },
  827: { region: "Galar", next: { name: "Thievul", level: 18 } },
  1000:{ region: "Paldea", final: true }
};

function regionFromTags(p){
  if (EXTRA_INFO[p.id]?.region) return EXTRA_INFO[p.id].region;
  const tg = (p.tags||[]).map(t=>t.toLowerCase());
  if (tg.includes("kanto")) return "Kanto";
  if (tg.includes("johto")) return "Johto";
  if (tg.includes("hoenn")) return "Hoenn";
  if (tg.includes("sinnoh")) return "Sinnoh";
  if (tg.includes("unova")) return "Unova";
  if (tg.includes("kalos")) return "Kalos";
  if (tg.includes("alola")) return "Alola";
  if (tg.includes("galar")) return "Galar";
  if (tg.includes("paldea")) return "Paldea";
  return "Kanto";
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}

async function loadData(){
  const cacheKey = "pokedex-cache-v31";
  const cached = localStorage.getItem(cacheKey);
  if (cached){
    try{
      state.pokedex = JSON.parse(cached);
      rebuildTypesAndTags();
      renderWho();
      return;
    } catch(_){}
  }

  let list = [];
  try{
    const resAll = await fetch("https://pokeapi.co/api/v2/pokemon?limit=1017");
    const json = await resAll.json();
    list = json.results.map((r) => {
      const id = Number(r.url.split("/").filter(Boolean).pop());
      return { id, name: capitalize(r.name), types: [], tags: [], sprite: officialArt(id) };
    });
  } catch(e){
    console.warn("Falha ao carregar lista completa, usando local base", e);
  }

  let base = [];
  try{
    const resLocal = await fetch("./data/kanto151.sample.json");
    base = await resLocal.json();
  } catch(e){
    console.warn("Falha ao ler base local", e);
  }

  const byId = new Map(list.map(p => [p.id, p]));
  for (const p of base){
    byId.set(p.id, { ...byId.get(p.id), ...p, sprite: p.sprite || officialArt(p.id) });
  }

  const merged = Array.from(byId.values());
  await fetchDetailsForMissing(merged);
  state.pokedex = merged.sort((a,b)=>a.id-b.id);
  rebuildTypesAndTags();
  localStorage.setItem(cacheKey, JSON.stringify(state.pokedex));
  renderWho();
}

async function fetchDetailsForMissing(list){
  const targets = list.filter(p => !p.types || !p.types.length);
  const concurrency = 25;
  for (let i = 0; i < targets.length; i += concurrency){
    const slice = targets.slice(i, i+concurrency);
    await Promise.all(slice.map(async (p) => {
      try{
        const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${p.id}`);
        if (!res.ok) return;
        const data = await res.json();
        p.name = capitalize(data.name);
        p.types = data.types.map(t => capitalize(t.type.name));
        p.sprite = officialArt(p.id);
      } catch(_){}
    }));
  }
}

function capitalize(s){
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function rebuildTypesAndTags(){
  state.types = new Set();
  state.tags  = new Set();
  for (const p of state.pokedex){
    (p.types||[]).forEach(t => state.types.add(t));
    (p.tags||[]).forEach(t => state.tags.add(t));
  }
  populateSelect("f-type", Array.from(state.types).sort());
  populateSelect("f-tag", Array.from(state.tags).sort());
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
    <div class="item" data-pid="${p.id}" data-type="${(p.types||[])[0] || ""}">
      <div class="thumb">
        <img src="${getSprite(p)}" alt="Sprite de ${escapeHtml(p.name)}" loading="lazy"
             onerror="this.onerror=null; this.src='${spriteUrl(p.id)}';" />
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
  const summary = makeSummary(p, moves, abilities);
  const modal = $("who-modal");
  const detail = $("who-detail");
  detail.innerHTML = `
    <div class="modal-card emerald">
      <div class="modal-actions top-actions">
        <button class="modal-nav" id="who-prev">&#9664;</button>
        <button class="modal-close" id="who-close">X</button>
        <button class="modal-nav" id="who-next">&#9654;</button>
      </div>
      <div class="pokemon-profile-container">
        <div class="emerald-left profile-card">
        <div class="emerald-id">No.${p.id.toString().padStart(3,"0")}</div>
        <div class="emerald-sprite">
          <img src="${getSprite(p)}" alt="Sprite de ${escapeHtml(p.name)}" loading="lazy"
               onerror="this.onerror=null; this.src='${spriteUrl(p.id)}';" />
        </div>
        <div class="emerald-name">${escapeHtml(p.name)}</div>
        <div class="emerald-sub">${(p.types||[]).map(typeLabel).join(" / ")}</div>
      </div>
        <div class="emerald-right info-card">
          <div class="emerald-row header">PROFILE</div>
          <div class="emerald-row">TYPE: <span class="pill">${(p.types||[]).map(typeLabel).join(" / ")}</span></div>
          <div class="emerald-row">ABILITY: ${abilities.slice(0,1).map(escapeHtml).join(", ") || "-"}</div>
          <div class="emerald-row note resumo-container"><strong>Resumo:</strong> ${escapeHtml(summary)}</div>
        </div>
      </div>
      <div class="modal-actions bottom-actions">
        <button class="modal-nav" id="who-prev-bottom">&#9664; Anterior</button>
        <button class="modal-nav" id="who-next-bottom">Próximo &#9654;</button>
      </div>
    </div>
  `;
  modal.classList.add("open");
  modal.dataset.pid = p.id;
  const closeBtn = $("who-close");
  if (closeBtn){
    closeBtn.onclick = () => {
      modal.classList.remove("open");
      if ("speechSynthesis" in window){
        window.speechSynthesis.cancel();
        state.speech.currentUtter = null;
      }
    };
  }
  modal.addEventListener("click", (e) => {
    if (e.target === modal){
      modal.classList.remove("open");
      if ("speechSynthesis" in window){
        window.speechSynthesis.cancel();
        state.speech.currentUtter = null;
      }
    }
  });
  const prevBtn = $("who-prev");
  const nextBtn = $("who-next");
  if (prevBtn) prevBtn.onclick = () => showAdjacentPokemon(p.id, -1);
  if (nextBtn) nextBtn.onclick = () => showAdjacentPokemon(p.id, 1);
  const prevBottom = $("who-prev-bottom");
  const nextBottom = $("who-next-bottom");
  if (prevBottom) prevBottom.onclick = () => showAdjacentPokemon(p.id, -1);
  if (nextBottom) nextBottom.onclick = () => showAdjacentPokemon(p.id, 1);

  // Leitura em voz (pokeDex style)
  speakSummary(p, summary);
}

function showAdjacentPokemon(id, dir){
  const sorted = [...state.pokedex].sort((a,b)=>a.id-b.id);
  const idx = sorted.findIndex(x => x.id === id);
  if (idx === -1) return;
  const next = sorted[(idx + dir + sorted.length) % sorted.length];
  showWhoDetail(next);
}

function makeSummary(p, moves, abilities){
  const tipos = (p.types||[]).map(typeLabel).join(" e ") || "desconhecido";
  const golpes = moves.slice(0,3).join(", ");
  const hab = abilities.slice(0,1).join(", ") || "habilidade não informada";
  const reg = regionFromTags(p);
  const evo = evolutionText(p);
  return `${p.name} é um Pokémon do tipo ${tipos}. Principais golpes: ${golpes}. Habilidade comum: ${hab}. Região: ${reg}. ${evo}`;
}

function evolutionText(p){
  const info = EXTRA_INFO[p.id];
  if (info?.final) return "Esta é sua última evolução.";
  if (info?.next) return `Próxima evolução: ${info.next.name} a partir do nível ${info.next.level}.`;
  return "Evolução final conhecida.";
}

function speakSummary(p, summary){
  if (!("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();

  const voices = loadedVoices.length ? loadedVoices : synth.getVoices();
  const pickVoice = () => {
    const pt = voices.filter(v => (v.lang||"").toLowerCase().includes("pt"));
    return pt.find(v => v.name.includes("Google") && v.lang.toLowerCase().includes("br")) ||
           pt.find(v => /Luciana|Maria|Francisca|Heloisa/i.test(v.name)) ||
           pt.find(v => v.lang.toLowerCase().includes("br")) ||
           pt[0] || null;
  };
  const chosen = pickVoice();

  const text = `Número ${p.id}. ${p.name}. ${summary}`;
  const utter = new SpeechSynthesisUtterance(text);
  if (chosen){
    utter.voice = chosen;
    utter.lang = chosen.lang;
  } else {
    utter.lang = "pt-BR";
  }
  utter.rate = 0.95;
  utter.pitch = 1.1;
  state.speech.currentUtter = utter;
  synth.speak(utter);
}

// ---------- Fuzzy helper ----------
function levenshtein(a, b){
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({length: m+1}, () => new Array(n+1).fill(0));
  for (let i=0;i<=m;i++) dp[i][0] = i;
  for (let j=0;j<=n;j++) dp[0][j] = j;
  for (let i=1;i<=m;i++){
    for (let j=1;j<=n;j++){
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + cost
      );
    }
  }
  return dp[m][n];
}

function fuzzyBest(text){
  if (!text) return null;
  const names = state.pokedex || [];
  let best = null;
  let bestScore = Infinity;
  const normText = normalizeName(text);
  for (const p of names){
    const normName = normalizeName(p.name);
    const d = levenshtein(normText, normName);
    if (d < bestScore){
      bestScore = d;
      best = p;
    }
  }
  if (best && bestScore <= Math.max(2, Math.ceil(best.name.length * 0.3))){
    return best;
  }
  return null;
}

// Similaridade 0..1 baseada em Levenshtein
function similarity(a, b){
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (!longer.length) return 1;
  const dist = levenshtein(longer, shorter);
  return (longer.length - dist) / longer.length;
}

const OCR_SIMILARITY_MIN = 0.95;
const OCR_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚÂÊÎÔÛÃÕÄÖÜáéíóúâêîôûãõäöüçÇ0123456789'-. ";
function normalizeMatchText(text){
  return normalizeName(text).replace(/[^a-z0-9]+/g, "");
}
function normalizeOcrText(text){
  return normalizeName(text)
    .replace(/0/g, "o")
    .replace(/1/g, "l")
    .replace(/2/g, "z")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b");
}

/* ---------------------------
   MÓDULO 2 (Scanner QR / Nome)
---------------------------- */
async function startCamera(){
  if (state.stream) return;
  const video = $("video");
  const constraints = {
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      facingMode: "environment",
      advanced: [{ focusMode: "continuous" }]
    },
    audio: false
  };

  state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  // tenta aplicar zoom 2x se suportado
  try{
    const [track] = state.stream.getVideoTracks();
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.zoom){
      const newZoom = Math.min(caps.max || 2, 2);
      await track.applyConstraints({ advanced: [{ zoom: newZoom }] });
    }
  } catch(e){
    console.warn("Zoom não aplicado", e);
  }

  video.srcObject = state.stream;
  await video.play();

  $("btn-start").disabled = true;
  $("btn-stop").disabled = false;
  $("btn-ocr-capture").disabled = false;
  $("btn-ocr-retry").disabled = false;
  $("scan-status").textContent = "Câmera ativa. Centralize o nome do card e toque em Foto + OCR.";
  state.scanning = true;
  // auto captura em 3s
  if (state.ocrTimer) clearTimeout(state.ocrTimer);
  state.ocrTimer = setTimeout(() => captureAndOcr(), 3000);
  scanLoop();
}

function stopCamera(){
  state.scanning = false;
  if (state.ocrTimer){
    clearTimeout(state.ocrTimer);
    state.ocrTimer = null;
  }
  if (state.stream){
    for (const t of state.stream.getTracks()) t.stop();
    state.stream = null;
  }
  $("btn-start").disabled = false;
  $("btn-stop").disabled = true;
  $("btn-ocr-capture").disabled = true;
  $("btn-ocr-retry").disabled = true;
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
        const pokeById = findPokemon(m[1]);
        if (pokeById){
          $("scan-status").textContent = `QR lido: ${raw}`;
          stopCamera();
          showWhoDetail(pokeById);
          setRoute("who");
          return;
        }
      }
      const pokeByName = findPokemon(raw);
      if (pokeByName){
        $("scan-status").textContent = `QR lido: ${raw}`;
        stopCamera();
        showWhoDetail(pokeByName);
        setRoute("who");
        return;
      }
    }
  }

  requestAnimationFrame(scanLoop);
}

async function ensureOcr(){
  if (state.ocrWorker) return state.ocrWorker;
  if (!window.Tesseract || !window.Tesseract.createWorker) throw new Error("Tesseract não carregou.");
  const worker = await window.Tesseract.createWorker("eng", 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@v5.0.0/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0/tesseract-core.wasm.js",
    langPath: "https://tessdata.projectnaptha.com/4.0.0",
    logger: () => {}
  });
  await worker.load();
  try{
    await worker.loadLanguage("eng+por");
    await worker.initialize("eng+por");
  } catch (_){
    await worker.loadLanguage("eng");
    await worker.initialize("eng");
  }
  await worker.setParameters({
    tessedit_pageseg_mode: "7",
    tessedit_char_whitelist: OCR_WHITELIST,
    preserve_interword_spaces: "1"
  });
  state.ocrWorker = worker;
  return worker;
}

function makeCropCanvas(source, { x, y, w, h, scale = 2.5 }){
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = Math.floor(w * scale);
  canvas.height = Math.floor(h * scale);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Converte uma região para PB com upscale e retorna um canvas pronto para OCR.
function makeBinaryCanvas(source, { x, y, w, h, scale = 2.5, invert = false, threshold = 90 }){
  const canvas = makeCropCanvas(source, { x, y, w, h, scale });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4){
    const avg = (data[i] + data[i+1] + data[i+2]) / 3;
    let v = avg < threshold ? 0 : 255;
    if (invert) v = v === 0 ? 255 : 0;
    data[i] = data[i+1] = data[i+2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function matchNameFromText(text){
  const normRaw = normalizeOcrText(text);
  const compactRaw = normRaw.replace(/[^a-z0-9]+/g, "");
  if (!compactRaw) return null;
  const tokens = normRaw.split(/[^a-z0-9]+/).filter(Boolean);

  // 1) match exato por token
  for (const tok of tokens){
    const found = state.pokedex.find(p => normalizeMatchText(p.name) === tok);
    if (found) return found;
  }
  // 2) substring direta (resolve "Venusaur ex", "Zapdos da Equipe Rocket")
  for (const p of state.pokedex){
    const target = normalizeMatchText(p.name);
    if (compactRaw.includes(target)) return p;
  }
  // 3) similaridade alta (>=95%) em token ou texto completo
  let best = null;
  let bestScore = 0;
  const candidates = [compactRaw, ...tokens];
  for (const word of candidates){
    if (!word || word.length < 3) continue;
    for (const p of state.pokedex){
      const s = similarity(word, normalizeMatchText(p.name));
      if (s > bestScore){
        bestScore = s;
        best = p;
      }
    }
  }
  if (best && bestScore >= OCR_SIMILARITY_MIN) return best;
  return null;
}

async function ocrSnapshot(opts = { autoStop: false }){
  try{
    const video = $("video");
    if (!state.stream || video.readyState < 2){
      $("scan-status").textContent = "Abra a câmera antes de usar OCR.";
      console.warn("OCR abortado: vídeo não pronto", { readyState: video.readyState });
      return;
    }
    // ROI centralizada e simples para evitar cortes inválidos
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const cropW = Math.floor(vw * 0.84);
    const cropH = Math.min(300, Math.floor(vh * 0.22));
    const srcX = Math.max(0, Math.floor((vw - cropW) / 2));
    const roiY1 = Math.max(0, Math.floor(vh * 0.22));
    const roiY2 = Math.max(0, Math.floor(vh * 0.32));
    const rois = [
      { x: srcX, y: roiY1, w: cropW, h: cropH },
      { x: srcX, y: roiY2, w: cropW, h: cropH }
    ];

    console.log("OCR ROI", { video: { vw, vh }, rois, ready: video.readyState });

    // Preview colorido (antes da binarização)
    const preview = $("previewCanvas");
    if (preview){
      preview.width = cropW;
      preview.height = cropH;
      const pctx = preview.getContext("2d");
      pctx.clearRect(0,0,preview.width,preview.height);
      pctx.drawImage(video, srcX, roiY1, cropW, cropH, 0, 0, preview.width, preview.height);
    }

    $("scan-status").textContent = opts.autoStop ? "Foto capturada. Lendo nome..." : "Lendo nome (OCR)...";
    const worker = await ensureOcr();
    const texts = [];

    // helper para tentar leitura em um canvas
    const readCanvas = async (canvas, psm = "7") => {
      try{
        const { data: ocrData } = await worker.recognize(canvas, {
          tessedit_char_whitelist: OCR_WHITELIST,
          tessedit_pageseg_mode: psm,
          preserve_interword_spaces: "1"
        });
        if (ocrData.text) texts.push(ocrData.text);

        // render preview
        const preview = $("previewCanvas");
        if (preview){
          preview.width = canvas.width;
          preview.height = canvas.height;
          const pctx = preview.getContext("2d");
          pctx.clearRect(0,0,preview.width,preview.height);
          pctx.drawImage(canvas,0,0);
        }
      } catch (errWorker){
        console.warn("Worker OCR falhou, tentando fallback único:", errWorker);
        if (window.Tesseract && window.Tesseract.recognize){
          const res = await window.Tesseract.recognize(canvas, "eng", {
            tessedit_char_whitelist: OCR_WHITELIST,
            tessedit_pageseg_mode: psm,
            preserve_interword_spaces: "1"
          });
          if (res.data?.text) texts.push(res.data.text);
        } else if (window.OCRAD){
          try{
            const t = window.OCRAD(canvas) || "";
            if (t) texts.push(t);
          } catch (errO){
            console.warn("OCRAD falhou:", errO);
          }
        }
      }
    };

    const thresholds = [90, 120];
    for (const roi of rois){
      const colorCanvas = makeCropCanvas(video, { ...roi, scale: 2.5 });
      await readCanvas(colorCanvas, "6");
      for (const thr of thresholds){
        const canvasNormal = makeBinaryCanvas(video, { ...roi, invert: false, threshold: thr });
        const canvasInvert = makeBinaryCanvas(video, { ...roi, invert: true, threshold: thr });
        await readCanvas(canvasNormal, "7");
        await readCanvas(canvasInvert, "7");
      }
    }

    const rawText = texts.join(" ").trim();
    console.log("OCR bruto:", rawText);
    const found = matchNameFromText(rawText);
    if (found){
      $("scan-status").textContent = `Nome detectado: ${found.name}`;
      const displayResultado = $("resultadoNome");
      if (displayResultado) displayResultado.innerText = `Sucesso: ${found.name}`;
      showWhoDetail(found);
      setRoute("who");
      if (opts.autoStop) stopCamera();
    } else {
      const preview = $("previewCanvas");
      if (preview && !texts.length){
        // Mostra pelo menos o recorte mesmo sem texto
        preview.width = canvasNormal.width;
        preview.height = canvasNormal.height;
        const pctx = preview.getContext("2d");
        pctx.clearRect(0,0,preview.width,preview.height);
        pctx.drawImage(canvasNormal,0,0);
      }
      const displayResultado = $("resultadoNome");
      if (displayResultado) displayResultado.innerText = "Não reconhecido. Tente novamente.";
      $("scan-status").textContent = "Não reconheci um nome de Pokémon. Tente aproximar mais.";
    }
  } catch (e){
    console.error(e);
    $("scan-status").textContent = "Erro no OCR. Tente de novo com mais luz e o nome centralizado.";
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
    const canvas = $("emu-canvas");
    if (canvas){
      canvas.tabIndex = 0;
      canvas.addEventListener("click", () => canvas.focus());
    }
    state.emuReady = true;
    bindPadButtons(); // agora com WasmBoy pronto
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

async function stopRom(){
  if (!state.WasmBoy) return;
  try{
    await state.WasmBoy.pause();
  } catch(e){
    console.warn("Falha ao pausar ROM", e);
  }
}

async function saveRomState(){
  if (!state.WasmBoy) return;
  try{
    const stateBuf = await state.WasmBoy.saveState();
    if (stateBuf){
      const b64 = btoa(String.fromCharCode(...new Uint8Array(stateBuf)));
      localStorage.setItem("emu-save", b64);
      console.log("Save gravado");
    }
  } catch(e){
    console.warn("Não foi possível salvar o jogo", e);
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

const PRELOADED_ROMS = [
  // Arquivos que já estão na pasta ./roms/ (adicione mais e eles aparecerão na lista)
  { name: "Pokémon Red (local)", path: "./roms/Pokemon Red.gb" },
];

function populatePreloadedSelect(){
  const sel = $("rom-preloaded");
  if (!sel) return;
  sel.innerHTML = '<option value="">(escolha uma ROM pré-carregada)</option>';
  for (const rom of PRELOADED_ROMS){
    const opt = document.createElement("option");
    opt.value = rom.path;
    opt.textContent = rom.name;
    sel.appendChild(opt);
  }
}

async function loadPreloadedRom(){
  const sel = $("rom-preloaded");
  const val = sel?.value;
  if (!val) return;
  try{
    const res = await fetch(val);
    const buf = await res.arrayBuffer();
    state.lastRomBuffer = buf;
    state.roms.push({ name: val.split("/").pop(), note: "ROM pré-carregada" });
    saveRoms();
    renderRoms();
    updatePlayButton();
    autoRunRom(buf);
  } catch (e){
    console.error("Falha ao carregar ROM pré", e);
  }
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
      setRoute("menu");
      $("menu-grid").classList.remove("menu-hidden");
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
  $("btn-ocr-capture").addEventListener("click", captureAndOcr);
  $("btn-ocr-retry").addEventListener("click", () => {
    if (state.ocrTimer) clearTimeout(state.ocrTimer);
    captureAndOcr();
  });
  const selA = $("battle-a");
  const selB = $("battle-b");
  if (selA) selA.addEventListener("change", updateBattlePreview);
  if (selB) selB.addEventListener("change", updateBattlePreview);

  $("btn-add-rom").addEventListener("click", addRom);
  $("rom-file").addEventListener("change", addRom);
  $("btn-load-pre").addEventListener("click", loadPreloadedRom);
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
  const stopBtn = $("btn-stop-rom");
  if (stopBtn){
    stopBtn.addEventListener("click", stopRom);
  }
  const saveBtn = $("btn-save-rom");
  if (saveBtn){
    saveBtn.addEventListener("click", saveRomState);
  }

  bindPadButtons();
  bindFullscreen();
  populatePreloadedSelect();

  const battleBtn = $("btn-battle");
  if (battleBtn) battleBtn.addEventListener("click", simulateBattle);
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
  setRoute(["home","menu","who","scan","emu","battle"].includes(initial) ? initial : "home");

  await registerSW();
  await loadData();
  populateBattleSelects();
  updateBattlePreview();
  loadRoms();
})();

/* ---------------------------
   BATALHA SIMPLES
---------------------------- */
function populateBattleSelects(){
  const opts = state.pokedex.map(p => ({ value: p.id, label: `#${p.id.toString().padStart(3,"0")} ${p.name}` }));
  const selA = $("battle-a");
  const selB = $("battle-b");
  if (!selA || !selB) return;
  const fill = (sel, term = "") => {
    sel.innerHTML = "";
    const f = term.trim().toLowerCase();
    opts.filter(o => !f || o.label.toLowerCase().includes(f) || String(o.value).includes(f))
        .forEach(o => {
          const opt = document.createElement("option");
          opt.value = o.value;
          opt.textContent = o.label;
          sel.appendChild(opt);
        });
  };
  fill(selA);
  fill(selB);
  const searchA = $("battle-search-a");
  const searchB = $("battle-search-b");
  if (searchA) searchA.addEventListener("input", () => { fill(selA, searchA.value); updateBattlePreview(); });
  if (searchB) searchB.addEventListener("input", () => { fill(selB, searchB.value); updateBattlePreview(); });
}

function simulateBattle(){
  const selA = $("battle-a");
  const selB = $("battle-b");
  const log = $("battle-log");
  if (!selA || !selB || !log) return;
  if (state.battleTimer){
    clearTimeout(state.battleTimer);
    state.battleTimer = null;
  }
  resetBattleState();
  const idA = Number(selA.value);
  const idB = Number(selB.value);
  if (idA === idB){
    renderBattleLog("Type advantage", "SEM BATALHA", "Escolha dois Pokemon diferentes.");
    return;
  }
  const pokeA = state.pokedex.find(p => p.id === idA);
  const pokeB = state.pokedex.find(p => p.id === idB);
  if (!pokeA || !pokeB){
    renderBattleLog("Type advantage", "ERRO", "Pokemon invalido.");
    return;
  }
  const effectiveness = (atk, def) => {
    const chart = {
      Fire: { Grass: 1.6, Ice: 1.6, Bug: 1.3, Steel: 1.6, Water: 0.7, Rock: 0.7, Fire: 0.7 },
      Water:{ Fire: 1.6, Rock: 1.3, Ground: 1.3, Water: 0.7, Grass: 0.7 },
      Grass:{ Water: 1.6, Rock: 1.3, Ground: 1.3, Fire: 0.7, Grass: 0.7, Flying:0.7 },
      Electric:{ Water: 1.6, Flying:1.3, Ground:0, Grass:0.7 },
      Ice:{ Dragon:1.6, Grass:1.3, Ground:1.3, Flying:1.3, Fire:0.7, Water:0.7 },
      Fighting:{ Normal:1.6, Rock:1.6, Steel:1.6, Ice:1.3, Fairy:0.7, Flying:0.7, Psychic:0.7 },
      Psychic:{ Fighting:1.6, Poison:1.3, Dark:0 },
      Dark:{ Psychic:1.6, Ghost:1.3, Fairy:0.7 },
      Ghost:{ Psychic:1.6, Ghost:1.3, Normal:0 },
      Fairy:{ Dragon:1.6, Fighting:1.3, Dark:1.3, Fire:0.7, Steel:0.7 },
      Rock:{ Fire:1.3, Flying:1.3, Ice:1.3, Fighting:0.7, Ground:0.7 },
      Ground:{ Electric:1.6, Fire:1.3, Steel:1.3, Poison:1.3, Flying:0 }
    };
    let mult = 1;
    const atkTypes = atk.types || [];
    const defTypes = def.types || [];
    for (const a of atkTypes){
      for (const d of defTypes){
        const val = chart[a]?.[d];
        if (val !== undefined) mult *= val;
      }
    }
    return mult || 1;
  };
  const calcPower = (p, target) => {
    const base = 50 + (p.types?.length||1)*8;
    const rand = Math.floor(Math.random()*10);
    const mult = effectiveness(p, target);
    const total = Math.round((base + rand) * mult);
    return { base, rand, mult, total };
  };
  const scoreA = calcPower(pokeA, pokeB);
  const scoreB = calcPower(pokeB, pokeA);
  const winner = scoreA.total === scoreB.total ? null : (scoreA.total > scoreB.total ? pokeA : pokeB);
  const winData = winner === pokeA ? scoreA : scoreB;
  const loseData = winner === pokeA ? scoreB : scoreA;
  const winType = winner ? typeLabel((winner.types||[])[0]||"") : "";
  const loseType = winner === pokeA ? typeLabel((pokeB.types||[])[0]||"") : typeLabel((pokeA.types||[])[0]||"");

  let badge = "EQUILIBRADO";
  if (winner){
    if (winData.mult >= 1.4) badge = "SUPER EFETIVO!";
    else if (winData.mult <= 0.8) badge = "POUCO EFETIVO";
  }

  let reason = "Empate! Rodem de novo.";
  if (winner){
    const loser = winner === pokeA ? pokeB : pokeA;
    reason = `${winner.name} venceu! ${winType} tem vantagem sobre ${loseType}. Bonus x${winData.mult.toFixed(2)}. Sorte ${winData.rand} vs ${loseData.rand}. ${loser.name} ficou fora de combate, leve até um pokecenter.`;
  }

  const hpA = Math.min(100, Math.max(10, Math.round(scoreA.total)));
  const hpB = Math.min(100, Math.max(10, Math.round(scoreB.total)));
  let finalHpA = hpA;
  let finalHpB = hpB;
  if (winner === pokeA) finalHpB = 0;
  if (winner === pokeB) finalHpA = 0;
  const atkA = Math.min(100, Math.max(10, Math.round((scoreA.base + scoreA.rand) * 0.8)));
  const atkB = Math.min(100, Math.max(10, Math.round((scoreB.base + scoreB.rand) * 0.8)));
  const hpElA = $("p1-hp");
  const hpElB = $("p2-hp");
  const atkElA = $("p1-atk");
  const atkElB = $("p2-atk");
  if (hpElA) hpElA.style.width = `${finalHpA}%`;
  if (hpElB) hpElB.style.width = `${finalHpB}%`;
  if (atkElA) atkElA.style.width = `${atkA}%`;
  if (atkElB) atkElB.style.width = `${atkB}%`;
  setAdvantage("p1", scoreA.mult);
  setAdvantage("p2", scoreB.mult);
  const cardA = $("pokemon-1-card");
  const cardB = $("pokemon-2-card");
  if (cardA) cardA.classList.add("shaking");
  if (cardB) cardB.classList.add("shaking");
  state.battleTimer = setTimeout(() => {
    if (cardA) cardA.classList.remove("shaking");
    if (cardB) cardB.classList.remove("shaking");
    if (winner === pokeA){
      cardA?.classList.add("winner-glow");
      cardB?.classList.add("loser-fade","defeated");
    } else if (winner === pokeB){
      cardB?.classList.add("winner-glow");
      cardA?.classList.add("loser-fade","defeated");
    }
    playLevelUpSound();
  }, 1500);

  renderBattleLog("Type advantage", badge, reason);
}

function updateBattlePreview(){
  const selA = $("battle-a");
  const selB = $("battle-b");
  const cardA = $("pokemon-1-card");
  const cardB = $("pokemon-2-card");
  if (cardA) cardA.classList.remove("winner-card","loser-card","winner-glow","loser-fade","shaking","defeated");
  if (cardB) cardB.classList.remove("winner-card","loser-card","winner-glow","loser-fade","shaking","defeated");
  renderBattleLog("Type advantage", "PRONTO", "Escolha os dois Pokemon e clique em Simular.");
  if (!selA || !selB) return;
  const pokeA = state.pokedex.find(p => p.id === Number(selA.value));
  const pokeB = state.pokedex.find(p => p.id === Number(selB.value));
  const fillCard = (prefix, poke) => {
    const img = $(`${prefix}-img`);
    const nameEl = $(`${prefix}-name`);
    const typesEl = $(`${prefix}-types`);
    const advEl = $(`${prefix}-advantage`);
    if (img && poke){
      img.src = getSprite(poke);
      img.alt = poke.name;
      img.style.display = "block";
      img.onerror = () => { img.onerror = null; img.src = spriteUrl(poke.id); };
    }
    if (nameEl) nameEl.textContent = poke ? poke.name : "Pokemon";
    if (typesEl) typesEl.innerHTML = poke ? (poke.types||[]).map(t => `<span class="type-badge">${escapeHtml(typeLabel(t))}</span>`).join("") : "";
    if (advEl) advEl.style.display = "none";
  };
  fillCard("p1", pokeA);
  fillCard("p2", pokeB);
  const hpElA = $("p1-hp");
  const hpElB = $("p2-hp");
  const atkElA = $("p1-atk");
  const atkElB = $("p2-atk");
  if (hpElA) hpElA.style.width = "100%";
  if (hpElB) hpElB.style.width = "100%";
  if (atkElA) atkElA.style.width = "100%";
  if (atkElB) atkElB.style.width = "100%";
}

function resetBattleState(){
  const cardA = $("pokemon-1-card");
  const cardB = $("pokemon-2-card");
  if (cardA) cardA.classList.remove("winner-card","loser-card","winner-glow","loser-fade","shaking","defeated");
  if (cardB) cardB.classList.remove("winner-card","loser-card","winner-glow","loser-fade","shaking","defeated");
  const hpElA = $("p1-hp");
  const hpElB = $("p2-hp");
  const atkElA = $("p1-atk");
  const atkElB = $("p2-atk");
  if (hpElA) hpElA.style.width = "100%";
  if (hpElB) hpElB.style.width = "100%";
  if (atkElA) atkElA.style.width = "100%";
  if (atkElB) atkElB.style.width = "100%";
  setAdvantage("p1", 1);
  setAdvantage("p2", 1);
}

function renderBattleLog(title, badge, text){
  const log = $("battle-log");
  if (!log) return;
  log.innerHTML = `
    <div class="battle-log-title">${escapeHtml(title)}</div>
    <div class="battle-log-badge">${escapeHtml(badge)}</div>
    <div class="battle-log-text">${escapeHtml(text)}</div>
  `;
}

function setAdvantage(prefix, mult){
  const advEl = $(`${prefix}-advantage`);
  if (!advEl) return;
  if (mult > 1.05){
    advEl.style.display = "block";
    advEl.textContent = "Vantagem de tipo";
  } else if (mult < 0.95){
    advEl.style.display = "block";
    advEl.textContent = "Desvantagem";
  } else {
    advEl.style.display = "none";
  }
}

function playLevelUpSound(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.1);
    });
  } catch(_) {}
}

/* ---------------------------
   Controles e Fullscreen
---------------------------- */
function sendKey(key, type){
  const ev = new KeyboardEvent(type, { key, code: key, bubbles: true });
  window.dispatchEvent(ev);
}
function sendKeyList(keys, type){
  for (const k of keys) sendKey(k, type);
}

function applyJoypadState(gbKey, down){
  if (!state.WasmBoy || !state.WasmBoy.setJoypadState) return;
  const canon = {
    UP: "up", DOWN: "down", LEFT: "left", RIGHT: "right",
    A: "a", B: "b", START: "start", SELECT: "select"
  };
  const base = canon[gbKey] || gbKey;
  const variants = [gbKey, gbKey.toUpperCase(), gbKey.toLowerCase(), base, base.toUpperCase(), base.toLowerCase()].filter(Boolean);
  const merged = {};
  for (const v of variants){
    state.joypadState[v] = down;
    merged[v] = state.joypadState[v];
  }
  state.WasmBoy.setJoypadState(merged);
}

function getWasmBoyInputAdapter(){
  const WB = state.WasmBoy;
  if (!WB) return null;
  const candidates = [
    // preferido: API direta de botão
    (down, key) => (WB.setJoypadButton ? WB.setJoypadButton(key, down) : undefined),
    // estado completo (mandamos maiúsculo e minúsculo por compatibilidade)
    (down, key) => {
      if (WB.setJoypadState){
        state.joypadState[key] = down;
        const full = { ...state.joypadState };
        // adicionar minúsculos e maiúsculos para cobrir variações
        const merged = {};
        for (const [k,v] of Object.entries(full)){
          merged[k] = v;
          merged[k.toUpperCase()] = v;
          merged[k.toLowerCase()] = v;
        }
        return WB.setJoypadState(merged);
      }
      return undefined;
    },
    (down, key) => (down && WB.pressKey ? WB.pressKey(key) : undefined),
    (down, key) => (!down && WB.releaseKey ? WB.releaseKey(key) : undefined),
    (down, key) => (down && WB.keyDown ? WB.keyDown(key) : undefined),
    (down, key) => (!down && WB.keyUp ? WB.keyUp(key) : undefined),
    (down, key) => (down && WB.setKeyDown ? WB.setKeyDown(key) : undefined),
    (down, key) => (!down && WB.setKeyUp ? WB.setKeyUp(key) : undefined),
  ];
  return (down, logicalKey) => {
    for (const fn of candidates){
      try {
        const out = fn(down, logicalKey);
        if (out !== undefined || fn.toString().includes("WB.")) return;
      } catch (_){}
    }
  };
}

function bindPadButtons(){
  const canvas = $("emu-canvas");
  document.querySelectorAll(".emu-controls [data-key]").forEach(btn => {
    const logical = btn.dataset.key;
    if (!logical) return;
    const down = (e) => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      canvas?.focus();
      const adapter = getWasmBoyInputAdapter();
      const gb = PAD_LOGICAL[logical];
      if (adapter && gb) adapter(true, gb);
      if (gb) applyJoypadState(gb, true);
      if (PAD_KEYBOARD[logical]) sendKey(PAD_KEYBOARD[logical], "keydown");
      if (PAD_ALT_KEYS[logical]) sendKeyList(PAD_ALT_KEYS[logical], "keydown");
    };
    const up = (e) => {
      e.preventDefault();
      const adapter = getWasmBoyInputAdapter();
      const gb = PAD_LOGICAL[logical];
      if (adapter && gb) adapter(false, gb);
      if (gb) applyJoypadState(gb, false);
      if (PAD_KEYBOARD[logical]) sendKey(PAD_KEYBOARD[logical], "keyup");
      if (PAD_ALT_KEYS[logical]) sendKeyList(PAD_ALT_KEYS[logical], "keyup");
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("pointerleave", up);
  });
}

function bindFullscreen(){
  const shell = $("emu-shell");
  const fsBtn = $("btn-fs");
  if (!shell || !fsBtn) return;

  const toggle = async () => {
    try{
      if (!document.fullscreenElement){
        await shell.requestFullscreen();
        shell.classList.add("fullscreen");
      } else {
        await document.exitFullscreen();
        shell.classList.remove("fullscreen");
      }
    } catch (e){
      console.warn("Fullscreen falhou", e);
    }
  };
  const updateIcon = () => {
    fsBtn.textContent = document.fullscreenElement ? "🗗" : "⛶";
    if (!document.fullscreenElement) shell.classList.remove("fullscreen");
  };
  fsBtn.addEventListener("click", (e) => { e.preventDefault(); toggle(); });
  document.addEventListener("fullscreenchange", updateIcon);
  updateIcon();
}


