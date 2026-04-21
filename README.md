# YouTube English Study

Extensão do Chrome que colore as legendas do YouTube em tempo real:

- **Verde** = palavra que você já conhece
- **Amarelo** = palavra nova para estudar

Clique em qualquer palavra direto na legenda para marcá-la como conhecida (ou desmarcá-la). Um painel lateral mostra estatísticas do vídeo e a lista acumulada de palavras novas.

## Instalação

1. Abra `chrome://extensions` no Chrome.
2. Ative **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione esta pasta.
4. Abra qualquer vídeo do YouTube e ative as legendas (botão CC).

## Uso

- As palavras da legenda aparecem coloridas automaticamente.
- Clique numa palavra para alternar conhecida ↔ nova.
- No popup da extensão (ícone na barra) você pode pesquisar, adicionar, remover, exportar e importar a lista de palavras conhecidas em JSON.

## Arquivos

- `manifest.json` — manifest MV3
- `content.js` / `content.css` — injeta no YouTube, observa e modifica os `.ytp-caption-segment`
- `popup.html` / `popup.js` / `popup.css` — UI de gerenciamento do vocabulário
