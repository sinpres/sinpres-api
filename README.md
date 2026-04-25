# SINPRES API

**Sistema Nacional de Preços Setoriais** — API pública e gratuita para consulta de insumos, composições e preços referenciais por setor da economia brasileira.

## URL base

```
https://api.sinpres.com.br
```

Não requer autenticação. Todos os endpoints são públicos.

## Por que este projeto existe?

A **Caixa Econômica Federal**, em parceria com o **IBGE**, mantém o **SINAPI** (Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil) — uma base de dados com milhares de insumos, composições e preços referenciais utilizados em obras públicas e privadas no Brasil. Esses dados são a referência oficial para orçamentos de obras financiadas com recursos públicos e servem como base para licitações, auditorias e planejamento de custos em todo o país.

O problema: **esses dados estão presos em PDFs e planilhas**. A Caixa disponibiliza os catálogos em documentos estáticos, o que dificulta a busca, filtragem, integração com sistemas e qualquer tipo de automação. Para um engenheiro, orçamentista ou desenvolvedor que precisa consultar um insumo específico ou montar um orçamento analítico, isso significa navegar manualmente por centenas de páginas de tabelas.

O **SINPRES** resolve isso. Extraímos os dados dos arquivos oficiais, estruturamos em um banco de dados relacional e disponibilizamos por meio de uma API REST moderna, gratuita e de código aberto — para que qualquer pessoa ou sistema possa consultar, filtrar e integrar esses dados de forma programática.

## Fonte dos dados e créditos

> **Todos os dados de insumos e composições da construção civil são provenientes do SINAPI, mantido pela Caixa Econômica Federal e pelo IBGE.**
>
> Os catálogos originais estão disponíveis em: [caixa.gov.br/sinapi](https://www.caixa.gov.br/poderpublico/modernizacao-gestao/sinapi/Paginas/default.aspx)
>
> Este projeto **não possui vínculo oficial** com a Caixa Econômica Federal ou com o IBGE. Trata-se de uma iniciativa independente que organiza dados públicos em formato acessível.

## Setores disponíveis

| Setor | Fonte | Status |
|---|---|---|
| Construção Civil | SINAPI (Caixa/IBGE) | Disponível — insumos e composições por UF e mês de referência |
| Saúde | — | Em breve |
| Alimentação | — | Em breve |
| Energia | — | Em breve |

## Arquitetura de dados

O SINPRES adota um **Star Schema (modelagem dimensional Kimball)** para separar o catálogo nacional de insumos e composições dos preços, que variam por UF, mês de referência e regime tributário. Essa separação reduz drasticamente o tamanho do catálogo pesquisável (~5 MB e 4.855 linhas, contra 310 MB e 191.742 linhas no desenho anterior) e torna cada insumo uma entidade única, com histórico rastreável.

As seis tabelas do setor Construção Civil (schema `civil_construction`):

| Tabela | Papel | Granularidade |
|---|---|---|
| `item_catalog` | Dimensão de insumos (SCD Type 1) | 1 linha por código SINAPI |
| `item_prices` | Fact table de preços de insumos (periodic snapshot) | código × UF × mês × regime |
| `composition_catalog` | Dimensão de composições (SCD Type 1) | 1 linha por código SINAPI |
| `composition_prices` | Fact table de preços de composições (periodic snapshot) | código × UF × mês × regime |
| `composition_items` | Coeficientes nacionais de insumos dentro de composições | composição × item (invariante por UF) |
| `categories` | Categorias do setor | 1 linha por categoria |

Além do schema setorial, `public.sectors` mantém o registro dos setores disponíveis na API.

### O campo `previousCode`

Tanto `item_catalog` quanto `composition_catalog` possuem o campo `previous_code` (`previousCode` no JSON de resposta). Ele armazena o código anterior de um insumo ou composição quando a Caixa publica uma substituição explícita — por exemplo, ao substituir o código `11616` pelo `11281`, o novo registro recebe `previous_code = 11616`.

Esse campo é **aditivo** e foi projetado para consumidores externos: se o seu sistema mantém registros locais referenciando códigos SINAPI, você pode consultar periodicamente os códigos da sua base e, quando a resposta retornar `previousCode != null`, atualizar suas referências para o novo código vigente. Quando `previousCode` é `null`, o código é original.

```bash
curl "https://api.sinpres.com.br/api/v1/sectors/civil-construction/items/11281" | jq '.data.previousCode'
# 11616  -> o 11281 substitui o 11616 na sua base
```

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
| `GET` | `/api/v1/sectors/:slug/compositions` | Buscar composições (paginado, com filtros) |
| `GET` | `/api/v1/sectors/:slug/compositions/:code` | Detalhar uma composição por código com itens |
| `GET` | `/api/v1/sinapi/states` | Listar UFs com dados disponíveis |
| `GET` | `/api/v1/sinapi/reference-months` | Listar meses de referência disponíveis |

## Busca de insumos

O endpoint de busca suporta **full-text search em português** (com stemming e normalização), filtragem por unidade de medida, UF, mês de referência e regime tributário.

### Parâmetros

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `search` | string | — | Termo de busca textual (ex: `tubo pvc`, `vergalhão`, `cimento`) |
| `unit` | string | — | Filtro por unidade de medida (`KG`, `M`, `M2`, `M3`, `UN`, `L`, etc.) |
| `state` | string | — | UF de 2 letras (ex: `SP`, `RJ`, `MG`) |
| `month` | string | último disponível | Mês de referência no formato `AAAA-MM` |
| `is_desonerated` | boolean | `false` | Regime tributário: `true` = desonerado, `false` = não desonerado |
| `page` | number | `1` | Número da página |
| `limit` | number | `50` | Itens por página (máx: `100`) |

### Exemplos

**Buscar insumos de tubo PVC em São Paulo:**

```bash
curl "https://api.sinpres.com.br/api/v1/sectors/civil-construction/items?search=tubo+pvc&state=SP&limit=10"
```

**Filtrar por unidade (quilograma) e mês de referência:**

```bash
curl "https://api.sinpres.com.br/api/v1/sectors/civil-construction/items?unit=KG&month=2026-03&page=2"
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
      "stateCode": "SP",
      "referenceMonth": "2026-03",
      "isDesonerated": false,
      "unitPrice": 1234,
      "technicalStandards": "NBR 6118:2014; NBR 14931:2003; NBR 7480:2022",
      "generalInfo": "É utilizado em estrutura de concreto armado...",
      "imageUrl": "https://j57uww5mhge9cyoz.public.blob.vercel-storage.com/images/34.jpeg",
      "sourceUpdatedAt": "12/12/2018",
      "previousCode": null,
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

## Busca de composições

Composições representam serviços completos de construção civil (ex: "Alvenaria de vedação em bloco cerâmico") com seus insumos, coeficientes e preços resultantes.

### Parâmetros

| Parâmetro | Tipo | Padrão | Descrição |
|---|---|---|---|
| `search` | string | — | Termo de busca textual (ex: `alvenaria`, `revestimento`) |
| `unit` | string | — | Filtro por unidade de medida |
| `state` | string | — | UF de 2 letras |
| `month` | string | último disponível | Mês de referência no formato `AAAA-MM` |
| `is_desonerated` | boolean | `false` | Regime tributário |
| `page` | number | `1` | Número da página |
| `limit` | number | `50` | Itens por página (máx: `100`) |

### Exemplos

**Buscar composições de alvenaria:**

```bash
curl "https://api.sinpres.com.br/api/v1/sectors/civil-construction/compositions?search=alvenaria&state=SP"
```

**Detalhar uma composição com seus itens:**

```bash
curl "https://api.sinpres.com.br/api/v1/sectors/civil-construction/compositions/7327"
```

### Resposta de detalhe

```json
{
  "data": {
    "code": 7327,
    "description": "ALVENARIA DE VEDAÇÃO EM BLOCO CERÂMICO 9X19X19",
    "unit": "M2",
    "stateCode": "SP",
    "referenceMonth": "2026-03",
    "isDesonerated": false,
    "baseUnitCost": 15000,
    "sourceUpdatedAt": "15/04/2026",
    "previousCode": null,
    "items": [
      {
        "itemType": "INPUT",
        "code": 1234,
        "description": "BLOCO CERÂMICO 9X19X19",
        "unit": "UN",
        "resourceType": "MATERIAL",
        "coefficient": "25.000000",
        "unitPrice": 450,
        "totalPrice": 11250
      },
      {
        "itemType": "INPUT",
        "code": 5678,
        "description": "PEDREIRO",
        "unit": "H",
        "resourceType": "LABOR",
        "coefficient": "1.500000",
        "unitPrice": 2500,
        "totalPrice": 3750
      }
    ]
  }
}
```

## Metadados SINAPI

**Listar UFs disponíveis:**

```bash
curl "https://api.sinpres.com.br/api/v1/sinapi/states"
```

**Listar meses de referência disponíveis (por UF ou geral):**

```bash
curl "https://api.sinpres.com.br/api/v1/sinapi/reference-months?state=SP"
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

## Rodando localmente

Requisitos: [Bun](https://bun.sh), Docker e Docker Compose.

```bash
# 1. Dependências
bun install

# 2. Subir PostgreSQL via docker-compose
docker-compose up -d

# 3. Aplicar migrations
bun run db:migrate

# 4. Popular o banco (ver seção "Pipeline de importação" abaixo)
bun run db:seed

# 5. Subir a API em modo dev
bun run dev
```

### Pipeline de importação

A SINPRES API **não parseia XLSX nem PDF** — toda a extração de fontes oficiais SINAPI é feita pelo [`sinapi-extractor`](https://github.com/sinpres/sinapi-extractor) (Python), que produz JSONs estáveis. A API apenas consome esses JSONs e popula o banco.

Fluxo completo:

```
Caixa (Web)                sinapi-extractor (Python)              sinpres-api (Bun/TS)
┌──────────────┐           ┌────────────────────────────┐         ┌─────────────────────┐
│ XLSX Refer.  │ ─────────▶│ extract_reference.py       │ ──JSONs─▶│ runReferenceImport  │
│ XLSX Manut.  │ ─────────▶│ extract_maintenances.py    │ ──JSON──▶│ runMaintenances...  │
│ PDF Fichas   │ ─────────▶│ extract_technical_sheets.py│ ──JSON──▶│ runExtractorEnrich  │
└──────────────┘           └────────────────────────────┘         └─────────────────────┘
```

| Etapa | JSON consumido | Importador | Popula |
|---|---|---|---|
| 1 | `output/reference/` (5 JSONs + metadata) | `src/db/import/sinapi.ts` | `item_catalog`, `item_prices`, `composition_catalog`, `composition_prices`, `composition_items` |
| 2 | `output/items.json` | `src/db/import/enrich-from-extractor.ts` | Enriquece `item_catalog` com normas, info geral, imagens, data da ficha |
| 3 | `output/maintenances.json` | `src/db/import/maintenances.ts` | Preenche `previous_code` quando há substituição explícita |

**Workflow mensal — atalho de uma linha:**

```bash
# 1. Baixar o bundle da Caixa e jogar em ../sinapi-extractor/input/ mantendo os
#    nomes oficiais (SINAPI_Referência_AAAA_MM.xlsx etc.). A pasta input/ está
#    no .gitignore do extractor.

# 2. Rodar o pipeline completo passando só o mês:
bun run import:month 2026-04
```

Esse atalho roda o extractor em `../sinapi-extractor` e em seguida o seed da API. Internamente é um shell script (`scripts/import-month.sh`) que encadeia os dois passos.

**Workflow manual — quando você quer controle fino dos passos:**

```bash
# 1. No extractor: gerar os JSONs (input/ deve ter os arquivos)
cd ../sinapi-extractor
python3 src/extract_all.py 2026-04

# 2. No api: rodar o seed (consome os JSONs gerados)
cd ../sinpres-api
bun run db:seed
```

Os caminhos dos JSONs apontam por padrão para `../sinapi-extractor/output/`. Para sobrescrever:

```bash
SEED_REFERENCE_DIR=/caminho/output/reference \
SEED_EXTRACTOR_JSON=/caminho/output/items.json \
SEED_MAINTENANCES=/caminho/output/maintenances.json \
bun run db:seed
```

Arquivos ausentes são ignorados com aviso — útil quando você ainda não rodou alguma das etapas do extractor. Todos os importadores usam `ON CONFLICT DO UPDATE`, portanto o seed é idempotente.

### Testes

```bash
bun run test
```

## Documentação interativa

- **Especificação OpenAPI:** [api.sinpres.com.br/doc](https://api.sinpres.com.br/doc)
- **Interface web:** [sinpres.com.br](https://sinpres.com.br)

## Ecossistema SINPRES

| Repositório | Descrição |
|---|---|
| [`sinpres-api`](https://github.com/sinpres/sinpres-api) | Este projeto — API REST pública |
| [`sinpres-web`](https://github.com/sinpres/sinpres-web) | Frontend web: documentação renderizada e explorer público |
| [`sinapi-extractor`](https://github.com/sinpres/sinapi-extractor) | Extrator Python que converte todas as fontes oficiais SINAPI (XLSX de Referência, XLSX de Manutenções, PDF de Fichas Técnicas) em JSONs estáveis consumidos pelo seed desta API |

## Contribuindo

Contribuições são bem-vindas! Este é um projeto open-source e qualquer ajuda é apreciada — seja reportando bugs, sugerindo melhorias ou enviando pull requests.

## Licença e créditos

MIT — Mantido por [TREE.IA](https://tree.ia.br?utm_source=sinpres&utm_medium=github&utm_campaign=api)
