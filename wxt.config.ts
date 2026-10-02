import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

const icons = Object.fromEntries([16, 24, 32, 64, 128].map((s) => [s, `icons/icon-${s}.png`]));

export default defineConfig({
  srcDir: "src",
  outDir: "dist",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: "Glossa",
    description:
      "Aprenda vocabulário com as legendas do YouTube: transcrição clicável, dicionário, flashcards e exercícios.",
    permissions: ["storage"],
    host_permissions: [
      "https://www.youtube.com/*",
      "https://translate.googleapis.com/*",
      "https://api.dictionaryapi.dev/*",
      "https://tatoeba.org/*",
      "https://api.tatoeba.org/*",
      "https://api.deepseek.com/*",
    ],
    optional_host_permissions: ["https://*/*"],
    icons,
    action: { default_title: "Glossa", default_icon: icons },
    options_ui: { page: "hub.html", open_in_tab: true },
  },
});
