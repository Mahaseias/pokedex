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
  joypadState: {
    up:false, down:false, left:false, right:false,
    A:false, B:false, START:false, SELECT:false
  },
};

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
  a: ["z", "x", "KeyZ", "KeyX"],
  b: ["x", "z", "KeyX", "KeyZ"],
  start: ["Enter", "Return"],
  select: ["Shift", "Backspace", "Space"]
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

  // abrir menu expandido por padrão
  if (route === "menu"){
    const grid = $("menu-grid");
    if (grid) grid.classList.remove("menu-hidden");
  }
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
  const summary = makeSummary(p, moves, abilities);
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
        <div class="emerald-row note"><strong>Resumo:</strong> ${escapeHtml(summary)}</div>
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

  // Leitura em voz (pokeDex style)
  speakSummary(p, summary);
}

function makeSummary(p, moves, abilities){
  const tipos = (p.types||[]).map(typeLabel).join(" e ") || "desconhecido";
  const golpes = moves.slice(0,3).join(", ");
  const hab = abilities.slice(0,1).join(", ") || "habilidade não informada";
  return `${p.name} é um Pokémon do tipo ${tipos}, conhecido por golpes como ${golpes}. Habilidade comum: ${hab}.`;
}

function speakSummary(p, summary){
  if (!("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();

  const voices = synth.getVoices();
  const pickVoice = () => {
    const ptVoices = voices.filter(v => (v.lang||"").toLowerCase().startsWith("pt"));
    // prefer feminino em pt-BR se existir
    const female = ptVoices.find(v => /female|feminina|mulher/i.test(v.name)) ||
                   ptVoices.find(v => /br/i.test(v.lang)) ||
                   ptVoices[0];
    return female || null;
  };
  const chosen = pickVoice();

  const text = `Número ${p.id}. ${p.name}. ${summary}`;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = chosen?.lang || "pt-BR";
  if (chosen) utter.voice = chosen;
  utter.rate = 0.95;
  utter.pitch = 1;
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
  video.srcObject = state.stream;
  await video.play();

  $("btn-start").disabled = true;
  $("btn-stop").disabled = false;
  $("btn-ocr-capture").disabled = false;
  $("scan-status").textContent = "Câmera ativa. Centralize o nome do card e toque em Foto + OCR.";
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
    tessedit_pageseg_mode: "7", // single text line
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚÂÊÎÔÛÃÕÄÖÜáéíóúâêîôûãõäöüçÇ "
  });
  state.ocrWorker = worker;
  return worker;
}

// Converte uma região para PB com upscale e retorna um canvas pronto para OCR.
function makeBinaryCanvas(video, { x, y, w, h, scale = 2.5, invert = false }){
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = Math.floor(w * scale);
  canvas.height = Math.floor(h * scale);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(video, x, y, w, h, 0, 0, canvas.width, canvas.height);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  const threshFixed = 90; // mais permissivo para imagens escuras
  for (let i = 0; i < data.length; i += 4){
    const avg = (data[i] + data[i+1] + data[i+2]) / 3;
    let v = avg < threshFixed ? 0 : 255;
    if (invert) v = v === 0 ? 255 : 0;
    data[i] = data[i+1] = data[i+2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function matchNameFromText(text){
  const norm = normalizeName(text);
  const tokens = norm.split(/[^a-z0-9]+/).filter(Boolean);
  // 1) match exato por token
  for (const tok of tokens){
    const found = state.pokedex.find(p => normalizeName(p.name) === tok);
    if (found) return found;
  }
  // 2) match por substring
  for (const p of state.pokedex){
    if (norm.includes(normalizeName(p.name))) return p;
  }
  // 3) fuzzy: pegar melhor distância entre tokens e nomes
  return fuzzyBest(norm);
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
    const cropW = Math.floor(vw * 0.8);
    const cropH = Math.min(200, Math.floor(vh * 0.25));
    const srcX = Math.max(0, Math.floor((vw - cropW) / 2));
    const srcY = Math.max(0, Math.floor((vh - cropH) / 2));

    console.log("OCR ROI", { video: { vw, vh }, crop: { srcX, srcY, cropW, cropH }, ready: video.readyState });

    // Preview colorido (antes da binarização)
    const preview = $("previewCanvas");
    if (preview){
      preview.width = cropW;
      preview.height = cropH;
      const pctx = preview.getContext("2d");
      pctx.clearRect(0,0,preview.width,preview.height);
      pctx.drawImage(video, srcX, srcY, cropW, cropH, 0, 0, preview.width, preview.height);
    }

    // duas variações: normal e invertida
    const canvasNormal = makeBinaryCanvas(video, { x: srcX, y: srcY, w: cropW, h: cropH, invert: false });
    const canvasInvert = makeBinaryCanvas(video, { x: srcX, y: srcY, w: cropW, h: cropH, invert: true });

    $("scan-status").textContent = opts.autoStop ? "Foto capturada. Lendo nome..." : "Lendo nome (OCR)...";
    const worker = await ensureOcr();
    const texts = [];

    // helper para tentar leitura em um canvas
    const readCanvas = async (canvas) => {
      try{
        const { data: ocrData } = await worker.recognize(canvas, {
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚÂÊÎÔÛÃÕÄÖÜáéíóúâêîôûãõäöüçÇ ",
          tessedit_pageseg_mode: "7"
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
            tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÉÍÓÚÂÊÎÔÛÃÕÄÖÜáéíóúâêîôûãõäöüçÇ ",
            tessedit_pageseg_mode: "7"
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

    await readCanvas(canvasNormal);
    await readCanvas(canvasInvert);

    const found = matchNameFromText(texts.join(" "));
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

  bindPadButtons();
  bindFullscreen();
  populatePreloadedSelect();
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

