const STORAGE_KEY = "knownWords";
const SEEN_KEY = "seenWords";

const $ = (id) => document.getElementById(id);

let words = [];
let seen = {};

async function load() {
  const data = await chrome.storage.local.get([STORAGE_KEY, SEEN_KEY]);
  words = (data[STORAGE_KEY] || []).slice().sort();
  seen = data[SEEN_KEY] || {};
  render();
}

async function save() {
  await chrome.storage.local.set({ [STORAGE_KEY]: words });
}

function render() {
  $("total").textContent = words.length;
  $("seen-total").textContent = Object.keys(seen).length;
  const q = $("search").value.trim().toLowerCase();
  const filtered = q ? words.filter((w) => w.includes(q)) : words;
  const list = $("list");
  if (!filtered.length) {
    list.innerHTML = `<div class="empty">${words.length ? "Nenhum resultado" : "Sem palavras ainda"}</div>`;
    return;
  }
  list.innerHTML = filtered
    .map(
      (w) =>
        `<li><span class="word">${escapeHtml(w)}</span><button class="del" data-word="${escapeHtml(w)}" title="Remover">×</button></li>`,
    )
    .join("");
}

function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

$("search").addEventListener("input", render);

$("list").addEventListener("click", async (e) => {
  const btn = e.target.closest(".del");
  if (!btn) return;
  const w = btn.dataset.word;
  words = words.filter((x) => x !== w);
  await save();
  render();
});

$("add-btn").addEventListener("click", addWord);
$("add-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addWord();
});

async function addWord() {
  const raw = $("add-input").value.trim().toLowerCase();
  if (!raw) return;
  const tokens = (raw.match(/[a-zA-ZÀ-ÿ']+/g) || [])
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length >= 1);
  if (!tokens.length) return;
  const set = new Set(words);
  for (const t of tokens) set.add(t);
  words = [...set].sort();
  $("add-input").value = "";
  await save();
  render();
}

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(words, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `known-words-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$("import").addEventListener("click", () => $("file-input").click());
$("file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error("JSON precisa ser um array");
    const set = new Set(words);
    for (const w of arr) {
      if (typeof w === "string" && w.length >= 1) set.add(w.toLowerCase());
    }
    words = [...set].sort();
    await save();
    render();
  } catch (err) {
    alert("Erro ao importar: " + err.message);
  }
  e.target.value = "";
});

$("clear").addEventListener("click", async () => {
  if (!confirm("Apagar todas as palavras conhecidas?")) return;
  words = [];
  await save();
  render();
});

$("export-seen").addEventListener("click", () => {
  const entries = Object.entries(seen).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) {
    alert("Nenhuma palavra vista ainda. Assista um video com legendas.");
    return;
  }
  const text = "palavra\tvezes\n" + entries.map(([w, c]) => `${w}\t${c}`).join("\n") + "\n";
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vistas-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

$("clear-seen").addEventListener("click", async () => {
  if (!confirm("Apagar historico de palavras vistas? (suas palavras conhecidas NAO serao afetadas)")) return;
  seen = {};
  await chrome.storage.local.set({ [SEEN_KEY]: seen });
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE_KEY]) {
    words = (changes[STORAGE_KEY].newValue || []).slice().sort();
    render();
  }
  if (changes[SEEN_KEY]) {
    seen = changes[SEEN_KEY].newValue || {};
    render();
  }
});

load();
