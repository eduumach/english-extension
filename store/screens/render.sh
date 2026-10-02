#!/usr/bin/env bash
# Renders the framed store screenshots (1280x800, 24-bit PNG) from store/screens/raw/*.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
enc() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1"; }
shot() { # out img title sub
  local url="file://$PWD/frame.html?img=$(enc "$2")&title=$(enc "$3")&sub=$(enc "$4")"
  "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=4000 \
    --allow-file-access-from-files --window-size=1280,800 --screenshot="$PWD/$1" "$url" >/dev/null 2>&1
  uv run -q --with pillow python -c "from PIL import Image; Image.open('$1').convert('RGB').save('$1')"
}
shot 1-legendas.png raw/1-video.jpg "Cada palavra na cor do que você sabe" "Verde para as aprendidas, amarelo para as já vistas e laranja para as novas. Clique numa palavra para marcá-la."
shot 2-dicionario.png raw/2-popup.jpg "Tradução na hora, sem sair do vídeo" "Shift + clique em qualquer palavra da legenda para ver tradução, sentidos e pronúncia."
shot 3-cartoes.png raw/3-cards.jpg "Frases do vídeo viram flashcards" "Repetição espaçada como no Anki, sem exportar nada, e o trecho original a um clique."
shot 4-vocabulario.png raw/4-vocab.jpg "Revise vocabulário com frases reais" "Exemplos com tradução para cada palavra. As que você dominar vão sozinhas para Aprendidas."
shot 5-progresso.png raw/5-home.jpg "Acompanhe sua evolução" "Palavras aprendidas, revisões do dia e acerto nos exercícios, tudo salvo no seu navegador."
