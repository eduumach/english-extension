import "./style.css";
import { logoSvg } from "@/lib/logo";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  runAt: "document_idle",
  main() {
    const STORAGE_KEY = "knownWords";
    const SEEN_KEY = "seenWords";
    const SETTINGS_KEY = "settings";
    const WORD_STATS_KEY = "wordStats";
    const QUIZ_HISTORY_KEY = "quizHistory";
    const CARDS_KEY = "cards";
    const QUIZ_SIZE = 8;
    const QUIZ_MAX_UNKNOWN = 5;
    const DEFAULT_SETTINGS = {
      enabled: true,
      studyLang: "en",
      targetLang: "pt",
      autoPause: false,
      pauseOnHover: true,
      quizAfterVideo: true,
    };
    const HOOK_IN = "yt-eng-content";
    const HOOK_OUT = "yt-eng-page";

    let knownWords = new Set();
    let seenWords = {};
    let settings = { ...DEFAULT_SETTINGS };
    let seenInVideo = new Set();
    let currentVideoId = null;
    let captionObserver = null;
    let panel = null;
    let isMutating = false;
    let seenSaveTimer = null;

    // Full caption track captured from the player (see page-hook.js)
    let lines = []; // { start, end, startMs, text }
    let trackKey = null;
    let trackInfo = null; // { lang, kind }
    let loadingKey = null;
    let triedSwitch = false;
    let enableTimer = null;
    let videoWordFreq = new Map();
    let activeIdx = -1;
    let pauseArmedIdx = -1;
    let pausedByHover = false;
    let hookReqId = 0;
    const hookPending = new Map();

    let savedCardKeys = new Set(); // "videoId|startMs"
    let cardQueue = Promise.resolve();
    let aiCardsBusy = false;
    let toastTimer = null;

    let quizEl = null;
    let quiz = null;
    const quizzedVideos = new Set();

    let popupEl = null;
    let popupWord = null;
    const lookupCache = new Map();

    // Word data (known, seen, quiz stats) is kept per studied language. English keeps
    // the original keys; same scheme as langKey in lib/common.ts.
    function langKey(base, lang = settings.studyLang) {
      return lang === "en" ? base : `${base}:${lang}`;
    }

    // BCP 47 tags for speech synthesis.
    const VOICE_LANGS = { en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-BR" };

    async function loadStorage() {
      const data = await chrome.storage.local.get([SETTINGS_KEY, CARDS_KEY]);
      savedCardKeys = new Set((data[CARDS_KEY] || []).map((c) => c.key));
      settings = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
      await loadWordData();
    }

    async function loadWordData() {
      const knownKey = langKey(STORAGE_KEY);
      const seenKey = langKey(SEEN_KEY);
      const data = await chrome.storage.local.get([knownKey, seenKey]);
      knownWords = new Set(data[knownKey] || []);
      seenWords = data[seenKey] || {};
    }

    async function saveKnownWords() {
      await chrome.storage.local.set({ [langKey(STORAGE_KEY)]: [...knownWords] });
    }

    function saveSettings() {
      chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }

    function scheduleSeenSave() {
      if (seenSaveTimer) return;
      seenSaveTimer = setTimeout(flushSeenSave, 1000);
    }

    function flushSeenSave(lang = settings.studyLang) {
      if (!seenSaveTimer) return;
      clearTimeout(seenSaveTimer);
      seenSaveTimer = null;
      chrome.storage.local.set({ [langKey(SEEN_KEY, lang)]: seenWords });
    }

    // New studied language: save what's pending under the old one, load the new word
    // data and start over on the current video so the matching caption track is picked.
    async function switchStudyLang(prevLang) {
      flushSeenSave(prevLang);
      await loadWordData();
      reprocessAllSegments();
      if (!settings.enabled) return;
      currentVideoId = null;
      onVideoChange();
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[langKey(STORAGE_KEY)]) {
        applyKnownWords(new Set(changes[langKey(STORAGE_KEY)].newValue || []));
      }
      if (changes[langKey(SEEN_KEY)]) {
        seenWords = changes[langKey(SEEN_KEY)].newValue || {};
      }
      if (changes[CARDS_KEY]) {
        savedCardKeys = new Set((changes[CARDS_KEY].newValue || []).map((c) => c.key));
        refreshSavedMarks();
      }
      if (changes[SETTINGS_KEY]) {
        const wasEnabled = settings.enabled;
        const prevLang = settings.studyLang;
        settings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue || {}) };
        updateToggleButtons();
        if (wasEnabled !== settings.enabled) applyEnabled();
        if (prevLang !== settings.studyLang) switchStudyLang(prevLang);
      }
    });

    // Only touch the DOM for words that actually changed; full re-render for bulk edits.
    function applyKnownWords(next) {
      const changed = [];
      for (const w of next) if (!knownWords.has(w)) changed.push(w);
      for (const w of knownWords) if (!next.has(w)) changed.push(w);
      if (!changed.length) return;
      knownWords = next;
      if (changed.length > 50) {
        reprocessAllSegments();
        renderTranscript();
        renderOverlay();
      } else {
        changed.forEach(refreshWordClasses);
      }
      updatePanel();
      updatePopupToggle();
    }

    const WORD_RE = /[a-zA-ZÀ-ÿ']+/g;

    function normalizeWord(w) {
      return w.toLowerCase().replace(/^'+|'+$/g, "");
    }

    function tokenize(text) {
      const matches = text.match(WORD_RE) || [];
      return matches.map(normalizeWord).filter((w) => w.length >= 1);
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

    function buildSegmentHTML(text) {
      const parts = text.split(/(\s+)/);
      return parts
        .map((part) => {
          if (!part) return "";
          if (/^\s+$/.test(part)) return part;
          const match = part.match(WORD_RE);
          if (!match) return escapeHtml(part);
          const word = normalizeWord(match[0]);
          if (word.length < 1) return escapeHtml(part);
          return `<span class="yt-eng-word yt-eng-${wordState(word)}" data-yt-eng-word="${escapeHtml(
            word,
          )}">${escapeHtml(part)}</span>`;
        })
        .join("");
    }

    // known = learned; seen = unknown but met in a previous video; new = first time ever.
    // The current video's own sighting is excluded so a word's color stays stable while watching.
    function wordState(word) {
      if (knownWords.has(word)) return "known";
      const before = (seenWords[word] || 0) - (seenInVideo.has(word) ? 1 : 0);
      return before > 0 ? "seen" : "new";
    }

    function refreshWordClasses(word) {
      const state = wordState(word);
      document
        .querySelectorAll(`.yt-eng-word[data-yt-eng-word="${CSS.escape(word)}"]`)
        .forEach((el) => {
          el.classList.remove("yt-eng-known", "yt-eng-seen", "yt-eng-new");
          el.classList.add(`yt-eng-${state}`);
        });
    }

    function markSeen(text) {
      for (const w of tokenize(text)) {
        if (seenInVideo.has(w)) continue;
        seenInVideo.add(w);
        seenWords[w] = (seenWords[w] || 0) + 1;
        scheduleSeenSave();
      }
    }

    /* ---------- Fallback: color YouTube's native caption segments ---------- */

    function processSegment(seg) {
      const currentText = seg.textContent;
      if (!currentText) return;
      if (
        seg.dataset.ytEngText === currentText &&
        seg.querySelector(".yt-eng-word")
      ) {
        return;
      }
      markSeen(currentText);
      isMutating = true;
      seg.innerHTML = buildSegmentHTML(currentText);
      seg.dataset.ytEngText = currentText;
      isMutating = false;
    }

    function processAllSegments() {
      // Native captions are hidden once we have the full track.
      if (lines.length || !settings.enabled) return;
      const segs = document.querySelectorAll(".ytp-caption-segment");
      segs.forEach(processSegment);
      updatePanel();
    }

    function reprocessAllSegments() {
      const segs = document.querySelectorAll(".ytp-caption-segment");
      isMutating = true;
      segs.forEach((seg) => {
        const text = seg.dataset.ytEngText || seg.textContent;
        if (!text) return;
        seg.innerHTML = buildSegmentHTML(text);
        seg.dataset.ytEngText = text;
      });
      isMutating = false;
    }

    function startCaptionObserver() {
      if (captionObserver) captionObserver.disconnect();

      const captionContainer =
        document.querySelector(".ytp-caption-window-container") ||
        document.querySelector(".caption-window") ||
        document.getElementById("movie_player");
      if (!captionContainer) return;

      let rafPending = false;

      captionObserver = new MutationObserver((mutations) => {
        if (isMutating || rafPending) return;

        // When observing broadly (movie_player), filter to caption-related mutations only
        if (!captionContainer.classList.contains("ytp-caption-window-container") &&
            !captionContainer.classList.contains("caption-window")) {
          let hasCaptionChange = false;
          for (const m of mutations) {
            const target = m.target;
            const el = target instanceof Element ? target : target.parentElement;
            if (el && el.closest(".ytp-caption-segment, .caption-window")) {
              hasCaptionChange = true;
              break;
            }
          }
          if (!hasCaptionChange) return;
        }

        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          processAllSegments();
        });
      });

      captionObserver.observe(captionContainer, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      processAllSegments();
    }

    /* ---------- Full track: capture, parse, translate ---------- */

    function postToHook(msg) {
      window.postMessage({ source: HOOK_IN, ...msg }, location.origin);
    }

    function hookFetch(key) {
      return new Promise((resolve, reject) => {
        const id = ++hookReqId;
        const timer = setTimeout(() => {
          hookPending.delete(id);
          reject(new Error("timeout"));
        }, 15000);
        hookPending.set(id, { resolve, reject, timer });
        postToHook({ type: "fetch-track", id, key });
      });
    }

    window.addEventListener("message", (e) => {
      if (e.source !== window || e.data?.source !== HOOK_OUT) return;
      const msg = e.data;
      if (msg.type === "captured") {
        onCaptured(msg);
      } else if (msg.type === "no-captions") {
        if (msg.videoId === currentVideoId && !lines.length) setStatus("none");
      } else if (msg.type === "fetch-result") {
        const pending = hookPending.get(msg.id);
        if (!pending) return;
        hookPending.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg.json);
      }
    });

    function onCaptured({ videoId, key, lang, kind }) {
      if (!settings.enabled || videoId !== currentVideoId || key === trackKey || key === loadingKey) return;
      const isStudy = lang.startsWith(settings.studyLang);
      if (trackInfo) {
        const curStudy = trackInfo.lang.startsWith(settings.studyLang);
        // Never swap a track in the studied language for another one, nor manual for auto-generated.
        if (curStudy && !isStudy) return;
        if (curStudy && trackInfo.kind !== "asr" && kind === "asr") return;
      }
      if (!isStudy && !triedSwitch) {
        triedSwitch = true;
        postToHook({ type: "enable-captions", videoId, lang: settings.studyLang });
      }
      loadTrack(videoId, key, { lang, kind });
    }

    function parseJson3(json) {
      const out = [];
      for (const ev of json?.events || []) {
        if (!ev.segs) continue;
        const text = ev.segs
          .map((s) => s.utf8 || "")
          .join("")
          .replace(/\s+/g, " ")
          .trim();
        if (!text) continue;
        const startMs = ev.tStartMs || 0;
        out.push({
          startMs,
          start: startMs / 1000,
          end: (startMs + (ev.dDurationMs || 0)) / 1000,
          text,
        });
      }
      // Auto-generated tracks overlap (rolling two-line captions): clip to the next start.
      for (let i = 0; i < out.length - 1; i++) {
        const next = out[i + 1];
        if (next.start > out[i].start && out[i].end > next.start) out[i].end = next.start;
      }
      return out;
    }

    async function loadTrack(videoId, key, info) {
      loadingKey = key;
      if (!lines.length) setStatus("loading");
      try {
        const parsed = parseJson3(await hookFetch(key));
        if (videoId !== currentVideoId || loadingKey !== key) return;
        if (!parsed.length) throw new Error("empty track");
        lines = parsed;
        trackKey = key;
        trackInfo = info;
        activeIdx = -1;
        pauseArmedIdx = -1;
        videoWordFreq = new Map();
        for (const l of lines) {
          for (const w of tokenize(l.text)) videoWordFreq.set(w, (videoWordFreq.get(w) || 0) + 1);
        }
        setHasTrack(true);
        setStatus("ready");
        renderTranscript();
        updatePanel();
      } catch {
        if (videoId === currentVideoId && !lines.length) setStatus("error");
      } finally {
        if (loadingKey === key) loadingKey = null;
      }
    }

    function setHasTrack(on) {
      document.getElementById("movie_player")?.classList.toggle("yt-eng-has-track", on);
    }

    function resetTrack() {
      lines = [];
      trackKey = null;
      trackInfo = null;
      loadingKey = null;
      triedSwitch = false;
      videoWordFreq = new Map();
      activeIdx = -1;
      pauseArmedIdx = -1;
      setHasTrack(false);
      renderOverlay();
    }

    /* ---------- Playback sync, auto-pause, navigation ---------- */

    function getVideo() {
      return (
        document.querySelector("#movie_player video.html5-main-video") ||
        document.querySelector("#movie_player video")
      );
    }

    function findLineAtOrBefore(t) {
      let lo = 0;
      let hi = lines.length - 1;
      let ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].start <= t) {
          ans = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return ans;
    }

    function findLine(t) {
      const i = findLineAtOrBefore(t);
      return i >= 0 && t < lines[i].end ? i : -1;
    }

    function bindVideo(v) {
      if (v.dataset.ytEngBound) return;
      v.dataset.ytEngBound = "1";
      v.addEventListener("seeked", () => {
        pauseArmedIdx = findLine(v.currentTime);
      });
      v.addEventListener("ended", onVideoEnded);
    }

    function tick() {
      // After the extension is reloaded/updated this old copy keeps running in the tab
      // with dead chrome.* APIs; clean up the page and stop.
      if (!chrome.runtime?.id) {
        teardown();
        return;
      }
      requestAnimationFrame(tick);
      const v = getVideo();
      if (!v) return;
      bindVideo(v);
      if (!lines.length) return;
      if (document.getElementById("movie_player")?.classList.contains("ad-showing")) {
        if (activeIdx !== -1) setActive(-1);
        return;
      }
      const t = v.currentTime;
      if (settings.autoPause && !v.paused && pauseArmedIdx >= 0) {
        const end = lines[pauseArmedIdx].end;
        if (t >= end - 0.08 && t < end + 0.5) {
          v.pause();
          pauseArmedIdx = -1;
        }
      }
      const idx = findLine(t);
      if (idx !== activeIdx) setActive(idx);
    }

    function setActive(idx) {
      activeIdx = idx;
      if (idx >= 0) {
        pauseArmedIdx = idx;
        markSeen(lines[idx].text);
        highlightTranscript(idx);
      }
      renderOverlay();
    }

    function currentCursor() {
      const v = getVideo();
      if (!v) return -1;
      return activeIdx >= 0 ? activeIdx : findLineAtOrBefore(v.currentTime);
    }

    function seekToLine(i) {
      const v = getVideo();
      if (!v || i < 0 || i >= lines.length) return;
      v.currentTime = lines[i].start + 0.01;
      pauseArmedIdx = i;
      if (v.paused) v.play();
    }

    function toggleSetting(name) {
      settings[name] = !settings[name];
      saveSettings();
      updateToggleButtons();
      // The storage echo can't detect this change anymore (settings is already updated).
      if (name === "enabled") applyEnabled();
    }

    document.addEventListener(
      "keydown",
      (e) => {
        if (quizEl) {
          onQuizKey(e);
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey || !currentVideoId || !settings.enabled) return;
        const t = e.target;
        if (
          t instanceof HTMLElement &&
          (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
        ) {
          return;
        }
        const key = e.key.toLowerCase();
        let handled = true;
        if (key === "escape" && popupEl) {
          closePopup();
        } else if (!lines.length) {
          handled = false;
        } else if (key === "a") {
          const c = currentCursor();
          seekToLine(Math.max(0, activeIdx >= 0 ? c - 1 : c));
        } else if (key === "d") {
          seekToLine(Math.min(lines.length - 1, currentCursor() + 1));
        } else if (key === "s") {
          seekToLine(Math.max(0, currentCursor()));
        } else if (key === "q") {
          toggleSetting("autoPause");
        } else if (key === "e") {
          saveCard(Math.max(0, currentCursor()));
        } else {
          handled = false;
        }
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );

    /* ---------- Subtitle overlay on the player ---------- */

    function ensureOverlay() {
      const player = document.getElementById("movie_player");
      if (!player) return null;
      let ov = player.querySelector("#yt-eng-overlay");
      if (ov) return ov;
      ov = document.createElement("div");
      ov.id = "yt-eng-overlay";
      ov.className = "empty";
      ov.innerHTML = `<div class="yt-eng-ov-box"><div class="yt-eng-ov-text"></div><button class="yt-eng-card-btn" title="Criar cartão (E)">+</button></div>`;
      player.appendChild(ov);
      const box = ov.querySelector(".yt-eng-ov-box");
      box.addEventListener("mouseenter", () => {
        const v = getVideo();
        if (settings.pauseOnHover && v && !v.paused) {
          v.pause();
          pausedByHover = true;
        }
      });
      box.addEventListener("mouseleave", () => {
        if (pausedByHover && !popupEl) getVideo()?.play();
        pausedByHover = false;
      });
      ov.addEventListener("dblclick", (e) => e.stopPropagation());
      new ResizeObserver(() => {
        const fs = Math.round(Math.min(42, Math.max(15, player.clientWidth * 0.027)));
        ov.style.setProperty("--yt-eng-fs", `${fs}px`);
      }).observe(player);
      return ov;
    }

    function renderOverlay() {
      const ov = ensureOverlay();
      if (!ov) return;
      const line = lines[activeIdx];
      ov.classList.toggle("empty", !line);
      if (!line) return;
      ov.querySelector(".yt-eng-ov-text").innerHTML = buildSegmentHTML(line.text);
      const btn = ov.querySelector(".yt-eng-card-btn");
      btn.dataset.card = activeIdx;
      btn.classList.toggle("saved", savedCardKeys.has(cardKey(activeIdx)));
    }

    /* ---------- Word popup (translation + dictionary) ---------- */

    const ICON_SPEAKER = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;

    function lookupWord(word) {
      const key = `${word}|${settings.studyLang}|${settings.targetLang}`;
      if (!lookupCache.has(key)) {
        const p = chrome.runtime
          .sendMessage({ type: "lookup", word, sl: settings.studyLang, tl: settings.targetLang })
          .catch((err) => ({ error: String(err?.message || err) }))
          .then((res) => {
            if (!res || res.error) lookupCache.delete(key);
            return res;
          });
        lookupCache.set(key, p);
      }
      return lookupCache.get(key);
    }

    function speak(text) {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = VOICE_LANGS[settings.studyLang] || settings.studyLang;
        u.rate = 0.9;
        speechSynthesis.speak(u);
      } catch {}
    }

    function openPopup(word, anchor) {
      closePopup();
      getVideo()?.pause();
      pausedByHover = false;
      popupWord = word;
      popupEl = document.createElement("div");
      popupEl.id = "yt-eng-popup";
      popupEl.innerHTML = `
        <div class="yt-eng-pp-head">
          <span class="yt-eng-pp-word">${escapeHtml(word)}</span>
          <span class="yt-eng-pp-phon"></span>
          <button class="yt-eng-pp-btn" data-act="speak" title="Ouvir">${ICON_SPEAKER}</button>
          <button class="yt-eng-pp-btn" data-act="close" title="Fechar (Esc)">×</button>
        </div>
        <div class="yt-eng-pp-body"><div class="yt-eng-pp-muted">Buscando…</div></div>
        <button class="yt-eng-pp-toggle" data-act="toggle"></button>`;
      (document.fullscreenElement || document.body).appendChild(popupEl);
      popupEl.addEventListener("click", (e) => {
        // Keep clicks from reaching the player (play/pause) when in fullscreen.
        e.stopPropagation();
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "speak") speak(word);
        else if (act === "close") closePopup();
        else if (act === "toggle") toggleKnown(word);
      });
      updatePopupToggle();
      positionPopup(anchor);
      lookupWord(word).then((res) => {
        if (popupWord !== word || !popupEl) return;
        renderPopupBody(res);
        positionPopup(anchor);
      });
    }

    function closePopup() {
      popupEl?.remove();
      popupEl = null;
      popupWord = null;
    }

    function positionPopup(anchor) {
      if (!popupEl || !anchor.isConnected) return;
      const r = anchor.getBoundingClientRect();
      const pw = popupEl.offsetWidth;
      const ph = popupEl.offsetHeight;
      const left = Math.min(
        Math.max(8, r.left + r.width / 2 - pw / 2),
        window.innerWidth - pw - 8,
      );
      let top = r.top - ph - 8;
      if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - ph - 8);
      popupEl.style.left = `${left}px`;
      popupEl.style.top = `${top}px`;
    }

    function renderPopupBody(res) {
      const body = popupEl.querySelector(".yt-eng-pp-body");
      if (!res || res.error) {
        body.innerHTML = `<div class="yt-eng-pp-muted">Não foi possível buscar a palavra.</div>`;
        return;
      }
      popupEl.querySelector(".yt-eng-pp-phon").textContent = res.phonetic || "";
      let html = "";
      if (res.translation) {
        html += `<div class="yt-eng-pp-tr">${escapeHtml(res.translation)}</div>`;
      }
      for (const a of res.alternatives || []) {
        html += `<div class="yt-eng-pp-alt"><i>${escapeHtml(a.pos)}</i> ${a.terms
          .map(escapeHtml)
          .join(", ")}</div>`;
      }
      if (res.definitions?.length) {
        html += `<ol class="yt-eng-pp-defs">${res.definitions
          .map(
            (d) =>
              `<li><i>${escapeHtml(d.pos)}</i> ${escapeHtml(d.definition)}${
                d.example ? `<div class="yt-eng-pp-ex">"${escapeHtml(d.example)}"</div>` : ""
              }</li>`,
          )
          .join("")}</ol>`;
      }
      body.innerHTML = html || `<div class="yt-eng-pp-muted">Nenhum resultado.</div>`;
    }

    function updatePopupToggle() {
      if (!popupEl || !popupWord) return;
      const btn = popupEl.querySelector(".yt-eng-pp-toggle");
      const known = knownWords.has(popupWord);
      btn.textContent = known ? "Marcar como nova" : "Marcar como conhecida";
      btn.classList.toggle("known", known);
    }

    /* ---------- Clicks ---------- */

    function toggleKnown(word) {
      if (!word) return;
      if (knownWords.has(word)) knownWords.delete(word);
      else knownWords.add(word);
      saveKnownWords();
      refreshWordClasses(word);
      updatePanel();
      updatePopupToggle();
    }

    function onDocumentClick(e) {
      const target = e.target instanceof Element ? e.target : null;
      if (!target || !settings.enabled) return;
      if (popupEl?.contains(target) || quizEl?.contains(target)) return;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      const chip = target.closest(".yt-eng-chip");
      const wordEl = target.closest(".yt-eng-word");
      if (popupEl && !wordEl) closePopup();

      if (chip) {
        stop();
        toggleKnown(chip.dataset.ytEngWord);
      } else if (wordEl) {
        stop();
        if (e.shiftKey) openPopup(wordEl.dataset.ytEngWord, wordEl);
        else toggleKnown(wordEl.dataset.ytEngWord);
      } else if (target.closest("[data-card]")) {
        stop();
        saveCard(Number(target.closest("[data-card]").dataset.card));
      } else if (target.closest(".yt-eng-line")) {
        stop();
        seekToLine(Number(target.closest(".yt-eng-line").dataset.ytEngLine));
      } else if (target.closest("#yt-eng-overlay")) {
        stop();
      }
    }

    document.addEventListener("click", onDocumentClick, true);

    /* ---------- Sentence cards ---------- */

    function cardKey(i) {
      return lines[i] ? `${currentVideoId}|${lines[i].startMs}` : "";
    }

    function refreshSavedMarks() {
      document.querySelectorAll(".yt-eng-card-btn[data-card]").forEach((btn) => {
        btn.classList.toggle("saved", savedCardKeys.has(cardKey(Number(btn.dataset.card))));
      });
    }

    function showToast(text, ms = 1800) {
      const player = document.getElementById("movie_player");
      if (!player) return;
      let toast = player.querySelector("#yt-eng-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "yt-eng-toast";
        player.appendChild(toast);
      }
      toast.textContent = text;
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), ms);
    }

    function appendCards(cards) {
      // Serialize read-modify-write so quick consecutive saves don't clobber each other.
      cardQueue = cardQueue.then(async () => {
        const data = await chrome.storage.local.get(CARDS_KEY);
        await chrome.storage.local.set({ [CARDS_KEY]: [...(data[CARDS_KEY] || []), ...cards] });
      });
      return cardQueue;
    }

    // The model picks the most useful transcript lines (by index, so timing stays exact)
    // and explains the words/expressions in context.
    async function generateAiCards() {
      if (!lines.length) {
        showToast("Espere as legendas carregarem");
        return;
      }
      if (aiCardsBusy) return;
      aiCardsBusy = true;
      const videoId = currentVideoId;
      const title = videoTitle();
      showToast("IA escolhendo frases para cartões...", 60000);
      try {
        const unknown = videoNewWords();
        const unknownSet = new Set(unknown);
        let idx = lines
          .map((_, i) => i)
          .filter((i) => tokenize(lines[i].text).some((w) => unknownSet.has(w)));
        if (!idx.length) idx = lines.map((_, i) => i);
        const items = [];
        let chars = 0;
        for (const i of idx) {
          chars += lines[i].text.length + 8;
          if (chars > 40000) break;
          items.push({ i, text: lines[i].text });
        }
        const res = await chrome.runtime
          .sendMessage({
            type: "ai-cards",
            items,
            unknown: unknown.slice(0, 100),
            sl: settings.studyLang,
            tl: settings.targetLang,
            max: 8,
          })
          .catch((err) => ({ error: String(err?.message || err) }));
        if (videoId !== currentVideoId) return;
        if (!res || res.error) {
          showToast(
            res?.error === "no-api-key"
              ? "Configure a IA no hub da extensão (Configurações)"
              : `Erro da IA: ${res?.error || "sem resposta"}`,
            4000,
          );
          return;
        }
        const cards = [];
        for (const c of res.cards) {
          const start = c.lineStart;
          const end = Math.min(c.lineEnd, start + 2, lines.length - 1);
          const key = cardKey(start);
          if (!lines[start] || savedCardKeys.has(key)) continue;
          savedCardKeys.add(key);
          cards.push({
            key,
            sentence: lines
              .slice(start, end + 1)
              .map((l) => l.text)
              .join(" "),
            words: [...new Set(c.focus.flatMap(tokenize))],
            translation: c.translation,
            wordNotes: [{ word: c.focus.join(", "), tr: c.explanation }],
            videoId,
            title,
            time: Math.floor(lines[start].start),
            ts: Date.now(),
            lang: settings.studyLang,
            source: "ai",
          });
        }
        if (cards.length) await appendCards(cards);
        refreshSavedMarks();
        showToast(
          cards.length ? `${cards.length} cartões criados pela IA` : "Nenhum cartão novo",
          3000,
        );
      } finally {
        aiCardsBusy = false;
      }
    }

    // Front: the sentence (unknown words get highlighted in review).
    // Back: sentence translation + meaning of those words, fetched now so review is instant.
    async function saveCard(i) {
      const line = lines[i];
      const key = cardKey(i);
      if (!line || !currentVideoId) return;
      if (savedCardKeys.has(key)) {
        showToast("Esta frase já virou cartão");
        return;
      }
      savedCardKeys.add(key);
      refreshSavedMarks();
      showToast("Criando cartão...");
      const words = [...new Set(tokenize(line.text))].filter(
        (w) => !knownWords.has(w) && w.length >= 3,
      );
      const back = await chrome.runtime
        .sendMessage({
          type: "card-back",
          sentence: line.text,
          words,
          sl: settings.studyLang,
          tl: settings.targetLang,
        })
        .catch(() => null);
      const card = {
        key,
        sentence: line.text,
        words,
        translation: back?.translation || "",
        wordNotes: back?.words || [],
        videoId: currentVideoId,
        title: videoTitle(),
        time: Math.floor(line.start),
        ts: Date.now(),
        lang: settings.studyLang,
      };
      await appendCards([card]);
      showToast(card.translation ? "Cartão criado" : "Cartão criado (sem tradução)");
    }

    /* ---------- Quiz (LLM exercises after the video) ---------- */

    async function onVideoEnded() {
      if (!settings.enabled || !settings.quizAfterVideo || quizEl || !currentVideoId) return;
      if (quizzedVideos.has(currentVideoId)) return;
      const status = await chrome.runtime.sendMessage({ type: "llm-status" }).catch(() => null);
      if (status?.configured) openQuiz();
    }

    function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    // Mostly words you don't know yet (most frequent in the video first), topped up
    // with known words you've been least tested on, to check you really know them.
    async function pickQuizWords() {
      const statsKey = langKey(WORD_STATS_KEY);
      const data = await chrome.storage.local.get(statsKey);
      const stats = data[statsKey] || {};
      const pool = seenInVideo.size ? [...seenInVideo] : [...videoWordFreq.keys()];
      const freq = (w) => videoWordFreq.get(w) || 0;
      const unknown = pool
        .filter((w) => !knownWords.has(w) && w.length >= 3)
        .sort((a, b) => freq(b) - freq(a))
        .slice(0, QUIZ_MAX_UNKNOWN);
      const known = shuffle(pool.filter((w) => knownWords.has(w) && w.length >= 4))
        .sort((a, b) => (stats[a]?.ok || 0) - (stats[b]?.ok || 0))
        .slice(0, QUIZ_SIZE - unknown.length);
      return shuffle([...unknown, ...known]).map((word) => ({
        word,
        context: lines.find((l) => tokenize(l.text).includes(word))?.text || "",
      }));
    }

    function cancelAutoplay() {
      const cancel = () =>
        document.querySelector(".ytp-autonav-endscreen-upnext-cancel-button")?.click();
      cancel();
      setTimeout(cancel, 600);
    }

    async function openQuiz() {
      if (quizEl) return;
      if (currentVideoId) quizzedVideos.add(currentVideoId);
      getVideo()?.pause();
      cancelAutoplay();
      quizEl = document.createElement("div");
      quizEl.id = "yt-eng-quiz";
      quizEl.innerHTML = `
        <div class="yt-eng-qz-card">
          <div class="yt-eng-qz-head">
            <span>Exercícios</span>
            <button class="yt-eng-qz-x" data-act="close" title="Fechar (Esc)">×</button>
          </div>
          <div class="yt-eng-qz-body"></div>
        </div>`;
      quizEl.addEventListener("click", onQuizClick);
      (document.fullscreenElement || document.body).appendChild(quizEl);

      const items = await pickQuizWords();
      if (items.length < 2) {
        quizMessage("Assista um pouco mais do vídeo para gerar exercícios.");
        return;
      }
      quizMessage(`Criando ${items.length} exercícios...`);
      const res = await chrome.runtime
        .sendMessage({ type: "quiz", items, sl: settings.studyLang, tl: settings.targetLang })
        .catch((err) => ({ error: String(err?.message || err) }));
      if (!quizEl) return;
      if (!res || res.error) {
        quizMessage(
          res?.error === "no-api-key"
            ? "Configure sua chave da API no hub da extensão: ícone da extensão → Abrir hub de estudo → Configurações."
            : `Erro ao gerar exercícios: ${res?.error || "sem resposta"}`,
        );
        return;
      }
      quiz = {
        questions: res.questions,
        i: 0,
        picked: null,
        results: [],
        videoId: currentVideoId,
        title: videoTitle(),
        wasKnown: new Map(items.map((it) => [it.word, knownWords.has(it.word)])),
        done: false,
      };
      renderQuestion();
    }

    function closeQuiz() {
      quizEl?.remove();
      quizEl = null;
      quiz = null;
    }

    function quizMessage(text) {
      quizEl.querySelector(".yt-eng-qz-body").innerHTML =
        `<div class="yt-eng-qz-msg">${escapeHtml(text)}</div>`;
    }

    function renderQuestion() {
      const q = quiz.questions[quiz.i];
      const answered = quiz.picked !== null;
      const last = quiz.i + 1 === quiz.questions.length;
      quizEl.querySelector(".yt-eng-qz-body").innerHTML = `
        <div class="yt-eng-qz-progress">${quiz.i + 1}/${quiz.questions.length}${
          // Showing the word would give away fill-in-the-blank answers.
          answered || q.type !== "fill_blank"
            ? ` · <span class="yt-eng-qz-word yt-eng-${wordState(q.word)}">${escapeHtml(q.word)}</span>`
            : ""
        }</div>
        <div class="yt-eng-qz-question">${escapeHtml(q.question)}</div>
        <div class="yt-eng-qz-options">${q.options
          .map((o, i) => {
            let cls = "";
            if (answered && i === q.answer) cls = " correct";
            else if (answered && i === quiz.picked) cls = " wrong";
            return `<button class="yt-eng-qz-opt${cls}" data-opt="${i}"${answered ? " disabled" : ""}><kbd>${i + 1}</kbd>${escapeHtml(o)}</button>`;
          })
          .join("")}</div>
        ${
          answered
            ? `<div class="yt-eng-qz-expl">${escapeHtml(q.explanation)}</div>
               <button class="yt-eng-qz-main" data-act="next">${last ? "Ver resultado" : "Próxima"} <kbd>Enter</kbd></button>`
            : ""
        }`;
    }

    function pickOption(i) {
      const q = quiz?.questions[quiz.i];
      if (!q || quiz.picked !== null || quiz.done || i >= q.options.length) return;
      quiz.picked = i;
      quiz.results.push({ word: q.word, ok: i === q.answer });
      renderQuestion();
    }

    function nextQuestion() {
      if (!quiz || quiz.picked === null || quiz.done) return;
      quiz.i++;
      quiz.picked = null;
      if (quiz.i < quiz.questions.length) renderQuestion();
      else finishQuiz();
    }

    async function finishQuiz() {
      quiz.done = true;
      const { results, wasKnown } = quiz;
      const statsKey = langKey(WORD_STATS_KEY);
      const data = await chrome.storage.local.get([statsKey, QUIZ_HISTORY_KEY]);
      const stats = data[statsKey] || {};
      const now = Date.now();
      for (const r of results) {
        const st = stats[r.word] || { ok: 0, fail: 0 };
        if (r.ok) st.ok++;
        else st.fail++;
        st.last = now;
        stats[r.word] = st;
      }
      // A "known" word you got wrong goes back to study.
      const demoted = results.filter((r) => !r.ok && wasKnown.get(r.word));
      demoted.forEach((r) => knownWords.delete(r.word));
      const correct = results.filter((r) => r.ok).length;
      const history = [
        ...(data[QUIZ_HISTORY_KEY] || []),
        { ts: now, videoId: quiz.videoId, title: quiz.title, correct, total: results.length },
      ].slice(-100);
      await chrome.storage.local.set({
        [statsKey]: stats,
        [QUIZ_HISTORY_KEY]: history,
        ...(demoted.length ? { [langKey(STORAGE_KEY)]: [...knownWords] } : {}),
      });
      demoted.forEach((r) => refreshWordClasses(r.word));
      updatePanel();
      if (!quizEl) return;

      const rows = results
        .map((r) => {
          const w = escapeHtml(r.word);
          let status;
          if (wasKnown.get(r.word)) {
            status = r.ok
              ? `<span class="yt-eng-qz-ok">confirmada</span>`
              : `<span class="yt-eng-qz-bad">voltou para estudar</span>`;
          } else {
            status = r.ok
              ? `<button class="yt-eng-qz-learn" data-act="learn" data-word="${w}">Marcar como aprendida</button>`
              : `<span class="yt-eng-qz-muted">continue estudando</span>`;
          }
          return `<div class="yt-eng-qz-row"><span class="yt-eng-qz-mark ${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"}</span><span class="yt-eng-qz-rw">${w}</span>${status}</div>`;
        })
        .join("");
      quizEl.querySelector(".yt-eng-qz-body").innerHTML = `
        <div class="yt-eng-qz-score">${correct}/${results.length}</div>
        <div class="yt-eng-qz-rows">${rows}</div>
        <button class="yt-eng-qz-main" data-act="close">Fechar <kbd>Enter</kbd></button>`;
    }

    function onQuizClick(e) {
      // Keep clicks from reaching the player (play/pause) when in fullscreen.
      e.stopPropagation();
      const opt = e.target.closest("[data-opt]");
      if (opt) {
        pickOption(Number(opt.dataset.opt));
        return;
      }
      const btn = e.target.closest("[data-act]");
      const act = btn?.dataset.act;
      if (act === "close") closeQuiz();
      else if (act === "next") nextQuestion();
      else if (act === "learn") {
        if (!knownWords.has(btn.dataset.word)) toggleKnown(btn.dataset.word);
        btn.outerHTML = `<span class="yt-eng-qz-ok">aprendida</span>`;
      }
    }

    function onQuizKey(e) {
      const key = e.key;
      if (key === "Escape") closeQuiz();
      else if (/^[1-9]$/.test(key)) pickOption(Number(key) - 1);
      else if (key === "Enter") {
        if (quiz?.done || !quiz) closeQuiz();
        else nextQuestion();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    }

    /* ---------- Side panel ---------- */

    const STATUS_TEXT = {
      waiting: "Procurando legendas...",
      loading: "Carregando legendas...",
      none: "Este vídeo não tem legendas.",
      error: "Não foi possível carregar as legendas.",
      ready: "",
    };

    function createPanel() {
      panel = document.createElement("div");
      panel.id = "yt-eng-ext-panel";
      panel.innerHTML = `
        <div class="yt-eng-header">
          <span class="yt-eng-title">
            ${logoSvg(16, "yt-eng-icon")}
            Glossa
          </span>
          <span class="yt-eng-header-actions">
            <button class="yt-eng-hbtn" id="yt-eng-help-btn" title="Ajuda e atalhos">?</button>
            <button class="yt-eng-hbtn" id="yt-eng-power" title="Desativar a extensão (reative pelo ícone da extensão)">
              <svg class="yt-eng-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
            </button>
            <button class="yt-eng-hbtn" id="yt-eng-toggle" title="Minimizar">—</button>
          </span>
        </div>
        <div class="yt-eng-body">
          <div class="yt-eng-hint-box" id="yt-eng-help" hidden>
            <span class="yt-eng-dot yt-eng-known"></span>aprendida
            <span class="yt-eng-dot yt-eng-seen"></span>já vista
            <span class="yt-eng-dot yt-eng-new"></span>nova<br>
            <b>Clique</b> marca/desmarca como aprendida · <b>Shift+clique</b> dicionário<br>
            <b>A</b>/<b>D</b> frase anterior/próxima · <b>S</b> repetir · <b>Q</b> pausa automática · <b>E</b> cartão<br>
            <a href="#" id="yt-eng-open-hub">Abrir hub de estudo →</a>
          </div>
          <div class="yt-eng-actions">
            <button class="yt-eng-action" id="yt-eng-practice" title="Exercícios com IA sobre as palavras deste vídeo">
              <svg class="yt-eng-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              Praticar
            </button>
            <button class="yt-eng-action" id="yt-eng-ai-cards" title="A IA escolhe frases deste vídeo e cria cartões">
              <svg class="yt-eng-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="16" height="14" rx="2"/><path d="M6 2h14a2 2 0 0 1 2 2v12"/></svg>
              Cartões IA
            </button>
            <button class="yt-eng-action yt-eng-toggle-btn" data-setting="autoPause" title="Pausar ao fim de cada frase (Q)">
              <svg class="yt-eng-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              Pausa auto
            </button>
          </div>
          <div class="yt-eng-stats">
            <div><span id="yt-eng-coverage">—</span><small>você entende</small></div>
            <div class="yt-eng-stat-seen"><span id="yt-eng-seen-count">0</span><small>já vistas</small></div>
            <div class="yt-eng-stat-new"><span id="yt-eng-new-count">0</span><small>novas</small></div>
          </div>
          <div class="yt-eng-status">
            <span id="yt-eng-status-text"></span>
            <button class="yt-eng-btn-icon" id="yt-eng-enable-cc">Ativar legendas</button>
          </div>
          <div id="yt-eng-transcript"></div>
          <details class="yt-eng-section" id="yt-eng-new-section">
            <summary class="yt-eng-label-row">
              <span class="yt-eng-label">Palavras que você não conhece <small>(<span id="yt-eng-unknown-count">0</span>)</small></span>
              <button class="yt-eng-btn-icon" id="yt-eng-export-video" title="Exportar as novas do vídeo como .txt">
                <svg class="yt-eng-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Exportar
              </button>
            </summary>
            <div id="yt-eng-new-list" class="yt-eng-chips"></div>
          </details>
        </div>
      `;
      document.body.appendChild(panel);

      panel.querySelector("#yt-eng-toggle").addEventListener("click", () => {
        panel.classList.toggle("collapsed");
        panel.querySelector("#yt-eng-toggle").textContent =
          panel.classList.contains("collapsed") ? "+" : "—";
      });
      panel.querySelectorAll(".yt-eng-toggle-btn").forEach((btn) =>
        btn.addEventListener("click", () => toggleSetting(btn.dataset.setting)),
      );
      panel.querySelector("#yt-eng-practice").addEventListener("click", openQuiz);
      panel.querySelector("#yt-eng-ai-cards").addEventListener("click", generateAiCards);
      panel.querySelector("#yt-eng-power").addEventListener("click", () => toggleSetting("enabled"));
      panel.querySelector("#yt-eng-help-btn").addEventListener("click", () => {
        const help = panel.querySelector("#yt-eng-help");
        help.hidden = !help.hidden;
        panel.querySelector("#yt-eng-help-btn").classList.toggle("on", !help.hidden);
      });
      panel.querySelector("#yt-eng-open-hub").addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: "open-hub" });
      });
      panel.querySelector("#yt-eng-enable-cc").addEventListener("click", () => {
        setStatus("waiting");
        postToHook({ type: "enable-captions", videoId: currentVideoId, lang: settings.studyLang });
      });
      panel.querySelector("#yt-eng-export-video").addEventListener("click", (e) => {
        e.preventDefault();
        exportVideoUnknown();
      });
      updateToggleButtons();
    }

    function updateToggleButtons() {
      panel?.querySelectorAll(".yt-eng-toggle-btn").forEach((btn) => {
        btn.classList.toggle("on", !!settings[btn.dataset.setting]);
      });
    }

    function setStatus(status) {
      if (!panel) return;
      panel.querySelector("#yt-eng-status-text").textContent = STATUS_TEXT[status];
      panel.querySelector(".yt-eng-status").hidden = status === "ready";
      panel.querySelector("#yt-eng-enable-cc").hidden = status === "loading" || status === "none";
    }

    function fmtTime(sec) {
      const s = Math.floor(sec);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = String(s % 60).padStart(2, "0");
      return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
    }

    function renderTranscript() {
      if (!panel) return;
      const list = panel.querySelector("#yt-eng-transcript");
      panel.classList.toggle("has-track", lines.length > 0);
      list.innerHTML = lines
        .map(
          (l, i) =>
            `<div class="yt-eng-line${i === activeIdx ? " active" : ""}" data-yt-eng-line="${i}">` +
            `<span class="yt-eng-time">${fmtTime(l.start)}</span>` +
            `<div class="yt-eng-line-body">${buildSegmentHTML(l.text)}</div>` +
            `<button class="yt-eng-card-btn${savedCardKeys.has(cardKey(i)) ? " saved" : ""}" data-card="${i}" title="Criar cartão (E)">+</button></div>`,
        )
        .join("");
    }

    function highlightTranscript(idx) {
      if (!panel) return;
      const list = panel.querySelector("#yt-eng-transcript");
      list.querySelector(".yt-eng-line.active")?.classList.remove("active");
      const el = list.querySelector(`[data-yt-eng-line="${idx}"]`);
      if (!el) return;
      el.classList.add("active");
      // Don't fight the user while they're scrolling the transcript.
      if (!list.matches(":hover")) {
        list.scrollTo({
          top: el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2,
          behavior: "smooth",
        });
      }
    }

    // document.title minus the " - YouTube" suffix and the "(12) " notification counter.
    function videoTitle() {
      return document.title
        .replace(/ - YouTube$/, "")
        .replace(/^\(\d+\+?\)\s*/, "")
        .trim();
    }

    function sanitizeFilename(s) {
      return s.replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 50);
    }

    function downloadText(content, filename) {
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    // Whole-transcript unknown words, most frequent first; falls back to what was seen on screen.
    function videoNewWords() {
      if (videoWordFreq.size) {
        return [...videoWordFreq.entries()]
          .filter(([w]) => !knownWords.has(w))
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([w]) => w);
      }
      return [...seenInVideo].filter((w) => !knownWords.has(w)).sort();
    }

    function exportVideoUnknown() {
      const words = videoNewWords();
      if (!words.length) {
        alert("Nenhuma palavra nova neste vídeo ainda.");
        return;
      }
      const rawTitle = videoTitle();
      const slug = sanitizeFilename(rawTitle) || currentVideoId || "video";
      downloadText(words.join("\n") + "\n", `novas-${slug}.txt`);
    }

    function updatePanel() {
      if (!panel) return;
      const newOnes = videoNewWords();
      panel.querySelector("#yt-eng-new-list").innerHTML = newOnes
        .map(
          (w) =>
            `<span class="yt-eng-chip yt-eng-${wordState(w)}" data-yt-eng-word="${escapeHtml(w)}">${escapeHtml(w)}</span>`,
        )
        .join("");
      const seenCount = newOnes.filter((w) => wordState(w) === "seen").length;
      let total = 0;
      let known = 0;
      for (const [w, c] of videoWordFreq) {
        total += c;
        if (knownWords.has(w)) known += c;
      }
      panel.querySelector("#yt-eng-seen-count").textContent = seenCount;
      panel.querySelector("#yt-eng-new-count").textContent = newOnes.length - seenCount;
      panel.querySelector("#yt-eng-unknown-count").textContent = newOnes.length;
      panel.querySelector("#yt-eng-coverage").textContent = total
        ? `${Math.round((known / total) * 100)}%`
        : "—";
    }

    /* ---------- Navigation ---------- */

    function getVideoIdFromUrl() {
      try {
        const u = new URL(location.href);
        if (u.pathname !== "/watch") return null;
        return u.searchParams.get("v");
      } catch {
        return null;
      }
    }

    // Turning off drops everything and hands captions back to YouTube;
    // turning on starts over for the current video.
    function applyEnabled() {
      closePopup();
      closeQuiz();
      clearTimeout(enableTimer);
      currentVideoId = null;
      resetTrack();
      if (settings.enabled) {
        onVideoChange();
        return;
      }
      if (panel) panel.style.display = "none";
      restoreNativeCaptions();
    }

    function restoreNativeCaptions() {
      isMutating = true;
      document.querySelectorAll(".ytp-caption-segment").forEach((seg) => {
        if (!seg.dataset.ytEngText) return;
        seg.textContent = seg.dataset.ytEngText;
        delete seg.dataset.ytEngText;
      });
      isMutating = false;
    }

    // Removes everything this script added to the page (also leftovers of a previous copy).
    function removeInjectedUi() {
      for (const id of ["yt-eng-ext-panel", "yt-eng-overlay", "yt-eng-toast", "yt-eng-popup", "yt-eng-quiz"]) {
        document.getElementById(id)?.remove();
      }
      document.getElementById("movie_player")?.classList.remove("yt-eng-has-track");
    }

    function teardown() {
      settings.enabled = false;
      captionObserver?.disconnect();
      clearTimeout(enableTimer);
      document.removeEventListener("click", onDocumentClick, true);
      removeInjectedUi();
      restoreNativeCaptions();
      panel = null;
      popupEl = null;
      quizEl = null;
      lines = [];
    }

    function onVideoChange() {
      if (!settings.enabled) return;
      const id = getVideoIdFromUrl();
      if (id === currentVideoId) return;
      currentVideoId = id;
      seenInVideo = new Set();
      resetTrack();
      closePopup();
      clearTimeout(enableTimer);
      if (!id) {
        if (panel) panel.style.display = "none";
        return;
      }
      if (!panel) createPanel();
      panel.style.display = "";
      setStatus("waiting");
      renderTranscript();
      updatePanel();
      waitForPlayerAndObserve();
      postToHook({ type: "request-track", videoId: id });
      // If the player didn't request captions on its own, turn them on.
      enableTimer = setTimeout(() => {
        if (currentVideoId === id && !lines.length && !loadingKey) {
          postToHook({ type: "enable-captions", videoId: id, lang: settings.studyLang });
        }
      }, 2500);
    }

    function waitForPlayerAndObserve() {
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        const target =
          document.querySelector(".ytp-caption-window-container") ||
          document.getElementById("movie_player");
        if (target) {
          startCaptionObserver();
          clearInterval(iv);
        } else if (tries > 40) {
          clearInterval(iv);
        }
      }, 500);
    }

    document.addEventListener("yt-navigate-finish", onVideoChange);
    window.addEventListener("popstate", onVideoChange);

    (async function init() {
      removeInjectedUi();
      restoreNativeCaptions();
      await loadStorage();
      onVideoChange();
      requestAnimationFrame(tick);
    })();
  },
});
