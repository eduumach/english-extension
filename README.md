# YouTube English Study

Extensão do Chrome que colore as legendas do YouTube em tempo real:

- **Verde** = palavra que você já aprendeu
- **Amarelo** = palavra que você já viu em outros vídeos, mas ainda não conhece
- **Laranja** = palavra que aparece pela primeira vez

Clique em qualquer palavra direto na legenda para marcá-la como conhecida (ou desmarcá-la). Um painel lateral mostra estatísticas do vídeo e a lista acumulada de palavras novas.

## Instalação

1. Abra `chrome://extensions` no Chrome.
2. Ative **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione esta pasta.
4. Abra qualquer vídeo do YouTube e ative as legendas (botão CC).

## Uso

- Abra um video com legendas: a extensao captura a faixa completa (ativa o CC sozinha se precisar) e mostra sua propria legenda colorida no player.
- O painel lateral mostra a transcricao inteira: clique numa frase para pular ate ela.
- Clique numa palavra para marca-la como aprendida (ou desmarcar); **Shift+clique** abre o dicionario.
- Atalhos: **A**/**D** frase anterior/proxima, **S** repetir frase, **Q** pausa automatica ao fim de cada frase.
- No popup da extensao voce escolhe o idioma do dicionario e gerencia (pesquisa, adiciona, exporta/importa) a lista de palavras conhecidas.

- Para assistir sem a extensao, desligue no popup (ou no botao de energia do painel): a legenda do YouTube volta ao normal e o icone mostra "OFF".

## Cartoes Anki

Clique no **+** de uma frase (na legenda ou na transcricao) ou tecle **E**. O cartao guarda:

- **Frente:** a frase, com as palavras que voce nao sabe em negrito.
- **Verso:** traducao da frase, significado dessas palavras e link para o momento exato do video.

Ou clique em **Cartoes IA** no painel: a IA le a transcricao e cria ate 8 cartoes com as frases mais uteis para voce (palavras que voce nao sabe, phrasal verbs, expressoes), com traducao e explicacao do trecho em foco.

No popup, **Exportar novos** gera um `.txt` pronto para o Anki (Arquivo → Importar).

## Exercicios com IA

Ao terminar um video (ou clicando em **Praticar** no painel), a IA cria ate 8 perguntas curtas de multipla escolha:

- ate 5 palavras que voce ainda nao sabe (as mais frequentes do video);
- o resto com palavras que voce marcou como aprendidas, para conferir se sabe mesmo.

Responda com **1–4** e avance com **Enter**. No resultado:

- palavra "aprendida" que voce errou volta para estudo automaticamente;
- palavra que voce nao sabia e acertou ganha um botao **Marcar como aprendida**.

O popup mostra o historico e a taxa de acerto. Para configurar, abra o popup → **IA para exercicios**, cole sua chave da [DeepSeek](https://platform.deepseek.com/api_keys) e clique em **Testar**. Qualquer API compativel com OpenAI (`/chat/completions`) funciona trocando a URL base e o modelo.

## Arquivos

- `manifest.json` — manifest MV3
- `page-hook.js` — roda no contexto da pagina e captura a requisicao `timedtext` do player para obter a faixa completa
- `content.js` / `content.css` — overlay de legenda, transcricao, popup de palavra, exercicios, atalhos; colore `.ytp-caption-segment` como fallback
- `llm.js` — cliente de chat compativel com OpenAI (DeepSeek por padrao), usado pelo background e pelo popup
- `background.js` — dicionario (Google Translate + dictionaryapi.dev) e geracao dos exercicios via LLM
- `popup.html` / `popup.js` / `popup.css` — configuracoes e gerenciamento do vocabulario
