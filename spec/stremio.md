# Spec: aba Stremio (tema glass)

Status: implementado · Depende de: spec/filmes-e-detalhes.md

## Objetivo

Uma quarta aba, "Stremio", com o mesmo layout de Filmes/Séries (destaque rotativo + linhas), em que cada linha é
um catálogo dos addons do Stremio. OK abre a mesma tela de detalhes, com o botão "Assistir no Stremio".

## Não objetivos

- Só catálogos e metadados (`/manifest.json`, `/catalog/…`, `/meta/…`). Nunca pede `/stream/…` nem resolve
  vídeo: quem reproduz é o app do Stremio.
- Sem login na conta Stremio nesta versão (biblioteca e "Continuar assistindo" ficam para depois).
- Abrir direto no título dentro do Stremio fica para depois (precisa de teste na TV); o botão abre o app.

## Ativação

- A aba aparece só no tema glass e quando o app do Stremio está instalado na TV (achado pelo nome).
- `config.properties`: `stremio_addons=` com os links `…/manifest.json` dos addons de catálogo, separados por
  vírgula, na ordem das linhas. Vazio: só o Cinemeta (`https://v3-cinemeta.strem.io/manifest.json`).
  Links de addons configurados podem levar dados da conta: ficam só no config.properties, como a chave TMDB.

## Linhas

- Para cada addon, na ordem do config, cada catálogo vira uma linha: "<nome do catálogo> · Filmes|Séries" (outros tipos, como anime, com o nome do tipo).
- Catálogos com extra obrigatório: só entram se o único obrigatório for `genre` (ex.: "New" do Cinemeta, que
  usa o ano mais recente da lista). Os demais (busca, ids) ficam de fora.
- No máximo 12 linhas. Linhas vazias ou com erro não aparecem.
- Miniatura: `background` do item; sem ele, o `poster`.

## Detalhes

- Item com `moviedb_id` (Cinemeta, addon do TMDB): detalhes do TMDB pelo id, como em Filmes/Séries.
- Item com id IMDb (`tt…`) sem `moviedb_id`: o TMDB converte (`/find`) e segue igual.
- Outros (ex.: `kitsu:`): detalhes do próprio addon (`/meta/…`): título, sinopse, fundo, gêneros, ano,
  nota IMDb, direção e elenco (só nomes, com a inicial no lugar da foto).
- Botão principal: "Assistir no Stremio" (abre o app). "Mais como este" abre com o mesmo botão.

## Critérios de aceite

- [x] Sem o app do Stremio instalado, nada muda (três abas).
- [x] Com ele, a aba aparece e lista os catálogos do Cinemeta (sem config).
- [x] Item do Cinemeta abre detalhes do TMDB; item sem TMDB abre detalhes do addon.
- [x] Nenhuma requisição a `/stream/`.
- [x] Tema clássico idêntico; no glass, Explorar, Filmes e Séries só ganham a quarta aba. `tools/check.sh web` passa.
