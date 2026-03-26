# SINPRES Explorer — Especificação

Especificação para implementar o frontend de exploração de dados do SINPRES como projeto separado (Next.js + Tailwind).

## Visão geral

Interface web para consulta e visualização dos dados da API SINPRES. Permite buscar, filtrar e visualizar detalhes de insumos de qualquer setor disponível.

## Páginas

### Página principal (`/`)

Tabela paginada com todos os itens do setor selecionado.

**Filtros (barra superior):**
- Campo de busca textual (full-text search) com debounce de 300ms
- Dropdown de seletor de setor (consome `GET /api/v1/sectors`)
- Dropdown de filtro por unidade de medida (KG, M, M2, M3, UN, L, etc.)
- Seletor de itens por página (25, 50, 100)

**Tabela:**
- Colunas: Codigo, Descricao, Unidade, Normas Tecnicas, Informacoes Gerais
- Descricao truncada em 80 caracteres
- Normas Tecnicas truncadas em 60 caracteres
- Informacoes Gerais truncadas em 100 caracteres
- Campos vazios exibem "—"
- Linhas clicaveis (abrem modal de detalhe)
- Hover com destaque na linha

**Paginacao:**
- Botoes: primeira, anterior, paginas numeradas (janela de 5), proxima, ultima
- Reticencias (...) quando ha mais paginas fora da janela
- Exibir: "X itens encontrados — Pagina Y de Z"

**Responsivo:**
- Em mobile, esconder colunas Normas Tecnicas e Informacoes Gerais
- Barra de filtros empilhada verticalmente

### Modal de detalhe do item

Abre ao clicar em qualquer linha da tabela. Exibe todas as informacoes do item.

**Conteudo:**
- Imagem do insumo (campo `imageUrl` da API) com fallback "Imagem indisponivel" se nao carregar ou "Sem imagem" se o campo for null
- Codigo (ex: #34)
- Descricao completa (sem truncar)
- Unidade de medida
- Data de atualizacao (campo `sourceUpdatedAt`)
- Normas Tecnicas completas
- Informacoes Gerais completas

**Comportamento:**
- Fecha com botao X
- Fecha ao clicar fora do modal (overlay)
- Fecha ao pressionar Escape
- Scroll interno se o conteudo for maior que a tela

## Endpoints consumidos

```
GET /api/v1/sectors
  → Lista de setores disponiveis (para popular o seletor)

GET /api/v1/sectors/{slug}/items?q=&unit=&page=&limit=
  → Busca paginada de itens com filtros

GET /api/v1/sectors/{slug}/items/{code}
  → Detalhe completo de um item (opcional — pode usar dados ja carregados da lista)
```

## Unidades de medida disponiveis (Construcao Civil)

100M, 310ML, CENTO, CJ, DIA, H, JG, KG, KWH, L, M, M/MES, M2, M2XMES, M2xMES, M3, MES, MIL, MXMES, PAR, SC25KG, T, UN, UNXMES

## Estrutura do JSON de resposta

### Lista paginada
```json
{
  "data": [
    {
      "id": 8,
      "categoryId": null,
      "code": 34,
      "description": "ACO CA-50, 10,0 MM, VERGALHAO",
      "unit": "KG",
      "technicalStandards": "NBR 6118:2014; NBR 14931:2003; NBR 7480:2022",
      "generalInfo": "E utilizado em estrutura de concreto armado...",
      "imageUrl": "images/34.jpeg",
      "metadata": null,
      "sourceUpdatedAt": "12/12/2018",
      "createdAt": "2026-03-26T15:52:41.194Z"
    }
  ],
  "meta": {
    "total": 6009,
    "page": 1,
    "limit": 50,
    "totalPages": 121
  }
}
```

## Tema

Light, consistente com a documentacao Scalar da API (`/reference`). Cores base:
- Background: #f6f8fa
- Card/tabela: #ffffff
- Borda: #d1d9e0
- Texto principal: #1f2328
- Texto secundario: #656d76
- Accent/links: #0969da
- Badge unidade: #ddf4ff com texto #0969da

## Links no header

- API Docs → /reference
- GitHub → https://github.com/sinpres/sinpres-api
- TREE.IA → https://tree.ia.br
