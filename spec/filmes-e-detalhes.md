# Spec: Filmes/Séries em linhas, tela de detalhes e barras que se escondem (tema glass)

Status: implementado (aprovado no canvas, telas 4, 4b e 5) · Depende de: spec/liquid-glass.md

## Objetivo

Nas abas Filmes e Séries, trocar os três destaques por uma página de linhas por categoria no estilo Apple TV,
com uma tela de detalhes ao apertar OK num título. Ao descer pelas linhas, as abas e a barra de apps saem de cena.

## Não objetivos

- Explorar continua como hoje (três destaques + barra fixa).
- Sem notas de IMDb, Rotten Tomatoes ou Metacritic nesta versão (só TMDB).
- Sem lista "Minha lista", sem trivia, músicas ou specs de áudio/vídeo.

## 1. Linhas por categoria (Filmes e Séries)

- Topo: destaque rotativo (5 títulos de "Em alta"), indicador de páginas, botões "Abrir no <app>" e Detalhes.
- Linhas, nesta ordem: Em alta, Lançamentos, depois gêneros (Ação, Comédia, Drama, Ficção
  científica, Animação, Documentário; Séries usa os gêneros de TV do TMDB). Só títulos disponíveis nos apps
  instalados (mesmo filtro dos destaques atuais).
- Sem repetição: cada título aparece só na primeira linha em que entra; as de baixo deixam de fora o que as de
  cima mostram. Se sobrarem menos de 10, a linha lê a página seguinte do TMDB (até 3 páginas).
- Miniaturas 16:9, 340×191, gap 24. ← → anda na linha; ↑ ↓ troca de linha mantendo a coluna mais próxima.
- Carregamento: na abertura, só o destaque e as 2 primeiras linhas. A próxima linha é pedida quando o foco
  chega a uma linha da última carregada. Linhas vazias não aparecem.
- Imagens `w500` nas miniaturas, carregadas só nas linhas a até 2 do foco (as outras ficam sem foto).

## 2. Abas e barra que se escondem

- Quando o foco desce do destaque para qualquer linha: abas sobem 40 px e somem; barra de apps desce 40 px e
  some. 0,25 s, curva sem quique, só `transform` e `opacity`.
- Voltam quando o foco sobe para o destaque, ou com Voltar: o primeiro Voltar rola até o topo e mostra as duas.
- Com as barras ocultas, um texto discreto no canto superior direito: "Voltar: topo e apps".
- Fora de Filmes/Séries, nada se esconde.

## 3. Tela de detalhes

- Abre com OK numa miniatura ou no botão Detalhes do destaque; Voltar fecha e devolve o foco ao mesmo título.
- Conteúdo (TMDB, idioma da TV): tipo e temporadas, título, nota TMDB (1 casa), ano, classificação indicativa
  do Brasil, gêneros, sinopse (até 4 linhas), criador/direção, 3 nomes do elenco.
- Botão: "Assistir no <app>" (primeiro app instalado com o título em assinatura). Sem app instalado, o botão
  some e "Onde assistir" fica como destaque.
- Onde assistir no Brasil: chips por serviço, marcando "instalado", "assinatura", "aluguel" ou "compra".
- Elenco: até 6 rostos com nome e papel.
- Abaixo: "Mais como este" (recomendações do TMDB; OK abre os detalhes delas, Voltar volta ao anterior).
  Temporadas e o filtro por apps instalados nas recomendações ficaram para depois.
- O botão abre o app na tela inicial dele. Abrir direto no título (Watchmode) e o Trailer ficaram para depois:
  o app web não tem como passar o título para os apps da Samsung sem testar cada um na TV.

## Desempenho

- A tela de detalhes não usa blur; chips e botões são vidro tingido.
- Troca do fundo da tela de detalhes e do destaque rotativo com o mesmo atraso de 220 ms do hero.

## Critérios de aceite

- [x] Explorar idêntico ao atual.
- [x] Filmes/Séries abre com destaque + 2 linhas e carrega a próxima ao descer.
- [x] Um título não se repete entre as linhas de uma aba.
- [x] Barras somem ao descer e voltam ao subir ou com Voltar.
- [x] OK abre detalhes; Voltar retorna ao mesmo título.
- [x] Botão principal abre o app instalado certo; sem app, não aparece.
- [x] `tools/check.sh web` passa.
