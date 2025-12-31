/* global jsQR */

const state = {
  pokedex: [],
  types: new Set(),
  tags: new Set(),
  roms: [],
  stream: null,
  scanning: false,
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

function spriteUrl(id){
  return `./assets/sprites/${Number(id)}.gif`;
}

const TYPE_PT = {
  Grass:"Grama", Poison:"Veneno", Fire:"Fogo", Water:"Água", Normal:"Normal",
  Flying:"Voador", Electric:"Elétrico", Psychic:"Psíquico", Ice:"Gelo",
  Rock:"Pedra", Ground:"Terra", Fighting:"Lutador", Bug:"Inseto",
  Ghost:"Fantasma", Dragon:"Dragão", Steel:"Aço", Fairy:"Fada"
};

function typeLabel(t){ return TYPE_PT[t] || t; }

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
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
   MÓDULO 1 (Who)
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
    <div class="modal-card">
      <button class="modal-close" id="who-close">X</button>
      <div class="profile-card">
        <div class="profile-header">
          <div class="thumb big">
            <img src="${spriteUrl(p.id)}" alt="Sprite de ${escapeHtml(p.name)}" loading="lazy" />
          </div>
          <div>
            <div class="profile-id">No.${p.id.toString().padStart(3,"0")}</div>
            <div class="profile-name">${escapeHtml(p.name)}</div>
            <div class="muted small">Tipos: ${(p.types||[]).map(typeLabel).join(" / ")}</div>
          </div>
        </div>
        <div class="profile-body">
          <div class="pill-row"><span class="label">Habilidade</span> ${abilities.slice(0,2).map(badge).join("")}</div>
          <div class="pill-row"><span class="label">Golpes</span> ${moves.slice(0,4).map(badge).join("")}</div>
          <div class="muted small note">Ficha estilo Emerald; habilidades/golpes são exemplos por tipo.</div>
        </div>
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
   MÓDULO 2 (Scanner QR)
---------------------------- */
async function startCamera(){
  if (state.stream) return;
  const video = $("video");

  // facingMode: environment tenta usar a câmera traseira.
  const constraints = { video: { facingMode: "environment" }, audio: false };

  state.stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = state.stream;
  await video.play();

  $("btn-start").disabled = true;
  $("btn-stop").disabled = false;
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
      // Esperamos que o QR contenha algo simples: "25" ou "pokemon_id=25"
      const raw = String(code.data).trim();
      const m = raw.match(/(\d{1,3})/);
      if (m){
        $("scan-id").value = m[1];
        $("scan-status").textContent = `QR lido: ${raw}`;
        stopCamera();
        loadPokemonFromScan();
        return;
      }
    }
  }

  requestAnimationFrame(scanLoop);
}

function loadPokemonFromScan(){
  const id = Number($("scan-id").value);
  const p = state.pokedex.find(x => x.id === id);
  const box = $("scan-detail");

  if (!p){
    box.innerHTML = `<div class="muted">Não encontrei o Pokémon com ID ${escapeHtml(id)}.</div>`;
    return;
  }

  box.innerHTML = `
    <div><strong>#${p.id.toString().padStart(3,"0")} ${escapeHtml(p.name)}</strong></div>
    <div class="muted">Tipos: ${(p.types||[]).map(escapeHtml).join(" / ")}</div>
    <div class="muted">Tags: ${(p.tags||[]).map(escapeHtml).join(", ")}</div>
    <div class="muted small">Próxima fase: anexar modelo 3D por ID e renderizar (Three.js).</div>
  `;
}

/* ---------------------------
   MÓDULO 3 (Emulador placeholder)
---------------------------- */
function loadRoms(){
  const raw = localStorage.getItem("roms");
  state.roms = raw ? JSON.parse(raw) : [];
  renderRoms();
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
    });
  });
}

async function addRom(){
  const inp = $("rom-file");
  if (!inp.files || !inp.files[0]) return;

  const f = inp.files[0];
  // Nota: para armazenar a ROM de verdade offline, precisamos IndexedDB (melhor do que localStorage).
  // Aqui deixamos o esqueleto + autoexec placeholder.
  state.roms.push({ name: f.name, note: "ROM adicionada (execução entra na fase do core emulada)." });
  saveRoms();
  renderRoms();
  inp.value = "";
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
  $("btn-load").addEventListener("click", loadPokemonFromScan);
  $("btn-open-dex").addEventListener("click", () => {
    const id = Number($("scan-id").value);
    const p = state.pokedex.find(x => x.id === id);
    if (p){
      showWhoDetail(p);
      setRoute("who");
    }
  });

  $("btn-add-rom").addEventListener("click", addRom);
  $("rom-file").addEventListener("change", addRom);
  $("btn-clear-roms").addEventListener("click", () => {
    state.roms = [];
    saveRoms();
    renderRoms();
  });
}

async function registerSW(){
  // Mesmo rodando no Safari “normal”, o SW ajuda no offline após primeira carga.
  if ("serviceWorker" in navigator){
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (e) {
      // Se estiver sem HTTPS, isso falha.
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



