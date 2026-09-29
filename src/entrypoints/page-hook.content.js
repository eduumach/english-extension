// Runs in the page's MAIN world (see manifest). YouTube's timedtext requests
// carry a proof-of-origin token, so the only reliable way to get the full
// caption track is to capture the URL the player itself requests and re-fetch
// it as json3.
export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    (() => {
      if (window.__ytEngHooked) return;
      window.__ytEngHooked = true;

      const SRC_IN = "yt-eng-content";
      const SRC_OUT = "yt-eng-page";
      const origFetch = window.fetch;
      const captured = new Map(); // "videoId|lang|kind" -> url

      function post(msg) {
        window.postMessage({ source: SRC_OUT, ...msg }, location.origin);
      }

      function describe(url) {
        const videoId = url.searchParams.get("v");
        const lang = url.searchParams.get("lang") || "";
        const kind = url.searchParams.get("kind") || "";
        return { videoId, lang, kind, key: `${videoId}|${lang}|${kind}` };
      }

      function onRequestUrl(raw) {
        if (!raw || !String(raw).includes("/api/timedtext")) return;
        let url;
        try {
          url = new URL(raw, location.href);
        } catch {
          return;
        }
        const info = describe(url);
        if (!info.videoId) return;
        captured.set(info.key, url.toString());
        post({ type: "captured", ...info });
      }

      window.fetch = function (input) {
        try {
          onRequestUrl(input instanceof Request ? input.url : String(input));
        } catch {}
        return origFetch.apply(this, arguments);
      };

      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try {
          onRequestUrl(String(url));
        } catch {}
        return origOpen.apply(this, arguments);
      };

      async function fetchTrack(key) {
        const base = captured.get(key);
        if (!base) throw new Error("track not captured");
        const url = new URL(base);
        url.searchParams.set("fmt", "json3");
        url.searchParams.delete("tlang");
        const res = await origFetch(url.toString(), { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text) throw new Error("empty response");
        return JSON.parse(text);
      }

      // Turn captions on through the player API so it issues a timedtext request.
      function enableCaptions(videoId, attempt = 0) {
        const player = document.getElementById("movie_player");
        const response = player?.getPlayerResponse?.();
        if (!response || (videoId && response.videoDetails?.videoId !== videoId)) {
          if (attempt < 10) setTimeout(() => enableCaptions(videoId, attempt + 1), 500);
          return;
        }
        const tracks =
          response.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (!tracks.length) {
          post({ type: "no-captions", videoId });
          return;
        }
        const isEn = (t) => (t.languageCode || "").startsWith("en");
        const pick =
          tracks.find((t) => isEn(t) && t.kind !== "asr") ||
          tracks.find(isEn) ||
          tracks[0];
        try {
          player.loadModule?.("captions");
          player.setOption?.("captions", "track", {
            languageCode: pick.languageCode,
            ...(pick.kind ? { kind: pick.kind } : {}),
          });
        } catch {}
      }

      window.addEventListener("message", async (e) => {
        if (e.source !== window || e.data?.source !== SRC_IN) return;
        const msg = e.data;
        if (msg.type === "request-track") {
          for (const url of captured.values()) {
            const info = describe(new URL(url));
            if (info.videoId === msg.videoId) post({ type: "captured", ...info });
          }
        } else if (msg.type === "fetch-track") {
          try {
            const json = await fetchTrack(msg.key);
            post({ type: "fetch-result", id: msg.id, json });
          } catch (err) {
            post({ type: "fetch-result", id: msg.id, error: String(err?.message || err) });
          }
        } else if (msg.type === "enable-captions") {
          enableCaptions(msg.videoId);
        }
      });
    })();
  },
});
