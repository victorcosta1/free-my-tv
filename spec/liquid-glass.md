# Spec: tema Liquid Glass (web/, LG e Samsung)

Status: implementado · Alvo inicial: Samsung 43CU7700 (2023, Tizen 7)

## Objetivo

Um segundo visual para o app web, inspirado no tvOS 26: hero em tela cheia com a imagem do destaque focado,
tema escuro e vidro real (`backdrop-filter`) nas abas, botões, barra de apps e painel. O visual atual
("classic") continua intacto e é o padrão.

## Não objetivos

- Não mexe no app Android (Canvas em Java).
- Não adiciona dados novos (sinopse, bateria do controle). O hero usa título e `meta` que já existem.
- Não muda navegação, zonas de foco nem atalhos.

## Ativação

- `config.properties`: `look=classic|glass|auto` (padrão `classic`).
  - `glass`: força o tema novo.
  - `auto`: usa `glass` só se `CSS.supports('backdrop-filter', 'blur(1px)')` (ou `-webkit-`); senão `classic`.
- `tools/webapp.py` lê a chave e grava `CONFIG.look`.
- `home.js` coloca a classe `lg` no `<body>`. Com `lg`, a classe `night` fica sempre ligada (escuro por padrão).
- Estilos do tema em `web/glass.css`, carregado depois de `home.css`. Todas as regras começam com `.lg`, então
  sem a classe nada muda.

## Tokens

| Token | Valor |
|---|---|
| Fundo | `#07080B` |
| Texto primário | `#F5F5F7` |
| Texto secundário | `rgba(245,245,247,0.72)` |
| Vidro | `rgba(255,255,255,0.10)` + `blur(40px) saturate(180%)` |
| Borda do vidro | `inset 0 1.5px 0 rgba(255,255,255,0.38)`, `inset 0 0 0 1px rgba(255,255,255,0.14)` |
| Sombra do vidro | `0 18px 50px rgba(0,0,0,0.35)` |
| Foco | fundo branco sólido, texto `#0B0C10`, `scale(1.06–1.14)`, sombra `0 30px 70px rgba(0,0,0,0.55)` |
| Raios | pill 30–42 px, cartão 26 px, barra 46 px, painel 44 px |
| Margens seguras | 80 px laterais, 56 px topo, 40 px base |
| Fonte | Inter (já empacotada) |

## Componentes

1. **Hero** (`#hero`, dentro de `#sky`): duas camadas que alternam com fade de 0,6 s, imagem `w1280` do destaque
   focado (ou do primeiro, fora da zona de destaques). Degradês: esquerda→direita e base→topo, para legibilidade.
   As canvas desfocadas do tema clássico ficam escondidas.
2. **Info do hero** (`#heroinfo`): título 104 px/700/−0,03 em e `meta` 26 px. Não recebe foco.
3. **Abas**: `#tabs` vira um pill de vidro em top 56. Aba ativa: branca 92%. Aba focada: branca + escala.
   O título "For You" some.
4. **Botões redondos**: 76 px, vidro, top 56. Focado: branco.
5. **Relógio** (`#now`): hora 34 px/600 + data 20 px, à esquerda dos botões.
6. **Destaques**: três miniaturas 16:9 (330×186) em top 620, acima da barra, a partir de x=80. Nome dentro da miniatura.
   Focado: escala 1,08 + borda branca 3 px.
7. **Barra de apps**: mesma geometria de hoje, `#platter` em vidro real. Tile focado como hoje. O primeiro tile é
   **TV ao vivo** (abre a entrada de TV ao vivo); o editor da barra fica com até 7 apps.
8. **Painel** (↓): `.glass`, `.key` e `.panel` em vidro real e cantos maiores.
9. **Folhas** (Todos os apps, Ajustes): fundo `rgba(0,0,0,0.55)` + blur 30 px.

## Desempenho

- Blur real (20 px, saturate 160%) só nas superfícies grandes: abas, barra, painéis do painel e folhas.
  Botões redondos e teclas do painel usam vidro tingido sem `backdrop-filter`.
- O hero só troca de foto depois que o foco para por 220 ms.
- Só `transform` e `opacity` animam. Blur nunca anima.
- `prefers-reduced-transparency`: vidro vira fundo sólido `rgba(28,28,30,0.92)`.

## Critérios de aceite

- [x] Com `look=classic` (ou sem a chave), o preview é idêntico ao atual.
- [x] Com `look=glass`, o preview mostra hero, abas em pill, barra e painel em vidro.
- [x] O hero troca de imagem ao mover o foco entre os destaques.
- [x] Sem TMDB key, o tema glass mostra o relógio grande sobre o fundo escuro, sem quebrar.
- [x] `tools/check.sh web` passa (ES5, pacotes e traduções).
