import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

const icons = Object.fromEntries([16, 24, 32, 64, 128].map((s) => [s, `icons/icon-${s}.png`]));

export default defineConfig({
  srcDir: "src",
  outDir: "dist",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: "YouTube English Study",
    description:
      "Estude inglês no YouTube: legendas duplas, transcrição clicável, dicionário e vocabulário.",
    permissions: ["storage"],
    host_permissions: [
      "https://www.youtube.com/*",
      "https://translate.googleapis.com/*",
      "https://api.dictionaryapi.dev/*",
      "https://api.deepseek.com/*",
    ],
    optional_host_permissions: ["https://*/*"],
    icons,
    action: { default_title: "YouTube English Study", default_icon: icons },
    options_ui: { page: "hub.html", open_in_tab: true },
  },
});
