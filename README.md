# SINPRES API

**Sistema Nacional de Preços Setoriais** — API pública e gratuita para consulta de insumos e preços referenciais por setor da economia brasileira.

## URL base

```
https://api.sinpres.com.br
```

Não requer autenticação. Todos os endpoints são públicos.

## Por que este projeto existe?

A **Caixa Econômica Federal**, em parceria com o **IBGE**, mantém o **SINAPI** (Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil) — uma base de dados com milhares de insumos, composições e preços referenciais utilizados em obras públicas e privadas no Brasil. Esses dados são a referência oficial para orçamentos de obras financiadas com recursos públicos e servem como base para licitações, auditorias e planejamento de custos em todo o país.

O problema: **esses dados estão presos em PDFs**. A Caixa disponibiliza os catálogos de insumos em documentos PDF estáticos, o que dificulta a busca, filtragem, integração com sistemas e qualquer tipo de automação. Para um engenheiro, orçamentista ou desenvolvedor que precisa consultar um insumo específico, isso significa navegar manualmente por centenas de páginas de tabelas.

O **SINPRES** resolve isso. Extraímos os dados dos PDFs oficiais, estruturamos em um banco de dados relacional e disponibilizamos por meio de uma API REST moderna, gratuita e de código aberto — para que qualquer pessoa ou sistema possa consultar, filtrar e integrar esses dados de forma programática.

## Fonte dos dados e créditos

> **Todos os dados de insumos da construção civil são provenientes do SINAPI, mantido pela Caixa Econômica Federal e pelo IBGE.**
>
> Os catálogos originais estão disponíveis em: [caixa.gov.br/sinapi](https://www.caixa.gov.br/poderpublico/modernizacao-gestao/sinapi/Paginas/default.aspx)
>
> Este projeto **não possui vínculo oficial** com a Caixa Econômica Federal ou com o IBGE. Trata-se de uma iniciativa independente que organiza dados públicos em formato acessível.

## Setores disponíveis

| Setor | Fonte | Status |
|---|---|---|
| Construção Civil | SINAPI (Caixa/IBGE) | Disponível — 6.009 insumos |
| Saúde | — | Em breve |
| Alimentação | — | Em breve |
| Energia | — | Em breve |

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/doc` | Especificação OpenAPI 3.1 (JSON) |
| `GET` | `/api/v1/sectors` | Listar todos os setores |
| `GET` | `/api/v1/sectors/:slug` | Detalhar um setor |
| `GET` | `/api/v1/sectors/:slug/categories` | Listar categorias de um setor |
| `GET` | `/api/v1/sectors/:slug/items` | Buscar insumos (paginado, com filtros) |
| `GET` | `/api/v1/sectors/:slug/items/:code` | Detalhar um insumo por código |

## Busca de insumos

O endpoint de busca suporta **full-text search em português** (com stemming e normalização) e filtragem por unidade de medida.

### Parâmetros

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `search` | string | — | Termo de busca textual (ex: `tubo pvc`, `vergalhão`, `cimento`) |
| `unit` | string | — | Filtro por unidade de medida (`KG`, `M`, `M2`, `M3`, `UN`, `L`, etc.) |
| `page` | number | `1` | Número da página |
| `limit` | number | `50` | Itens por página (máx: `100`) |

### Exemplos

**Buscar insumos de tubo PVC:**

```bash
curl "https://api.sinpres.com.br/api/v1/sectors/civil-construction/items?search=tubo+pvc&limit=10"
```

**Filtrar por unidade (quilograma):**

```bash
curl "https://api.sinpres.com.br/api/v1/sectors/civil-construction/items?unit=KG&page=2"
```

**Consultar insumo pelo código SINAPI:**

```bash
curl "https://api.sinpres.com.br/api/v1/sectors/civil-construction/items/34"
```

### Resposta

```json
{
  "data": [
    {
      "id": 8,
      "code": 34,
      "description": "ACO CA-50, 10,0 MM, VERGALHAO",
      "unit": "KG",
      "technicalStandards": "NBR 6118:2014; NBR 14931:2003; NBR 7480:2022",
      "generalInfo": "É utilizado em estrutura de concreto armado...",
      "imageUrl": "https://j57uww5mhge9cyoz.public.blob.vercel-storage.com/images/34.jpeg",
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

## Unidades de medida disponíveis

| Sigla | Descrição |
|---|---|
| `KG` | Quilograma |
| `M` | Metro |
| `M2` | Metro quadrado |
| `M3` | Metro cúbico |
| `UN` | Unidade |
| `L` | Litro |
| `T` | Tonelada |
| `H` | Hora |
| `DIA` | Dia |
| `MES` | Mês |
| `CJ` | Conjunto |
| `JG` | Jogo |
| `PAR` | Par |
| `MIL` | Milhar |
| `CENTO` | Cento |
| `SC25KG` | Saco de 25 kg |
| `KWH` | Quilowatt-hora |

## Documentação interativa

- **Especificação OpenAPI:** [api.sinpres.com.br/doc](https://api.sinpres.com.br/doc)
- **Interface web:** [sinpres.com.br](https://sinpres.com.br)

## Contribuindo

Contribuições são bem-vindas! Este é um projeto open-source e qualquer ajuda é apreciada — seja reportando bugs, sugerindo melhorias ou enviando pull requests.

## Licença e créditos

MIT — Mantido por [TREE.IA](https://tree.ia.br?utm_source=sinpres&utm_medium=github&utm_campaign=api)
