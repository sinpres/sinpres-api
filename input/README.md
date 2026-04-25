# input/

Pasta de onde o seed (`bun run db:seed`) lê os JSONs. Espelha exatamente a estrutura de output gerada pelo `sinapi-extractor`:

```
input/
├── reference/
│   ├── metadata.json
│   ├── items_catalog.json
│   ├── items_prices.json
│   ├── compositions_catalog.json
│   ├── compositions_prices.json
│   └── composition_items.json
├── maintenances.json
├── items.json
└── images/             (opcional — só se você for servir os arquivos via API)
```

Tudo nesta pasta está no `.gitignore` (exceto este README e o `.gitkeep`). Não comitar dados.

## Como popular

Esta API é **independente do `sinapi-extractor`** — não chama o extractor e não depende dele estar no filesystem. Você gera os JSONs onde quiser (mesma máquina, outra máquina, CI, etc.) e copia pra cá.

O fluxo típico, quando você tem o `sinapi-extractor` localmente:

```bash
# 1. No extractor, gerar os JSONs
cd ../sinapi-extractor
python3 src/extract_all.py 2026-04

# 2. Copiar os JSONs gerados para esta pasta
cp -r ../sinapi-extractor/output/reference          ./input/reference
cp    ../sinapi-extractor/output/maintenances.json  ./input/maintenances.json
cp    ../sinapi-extractor/output/items.json         ./input/items.json

# 3. Rodar o seed
bun run db:seed
```

A cada novo mês SINAPI publicado, repete o ciclo. Os imports são idempotentes — preços do mês novo são inseridos, preços de meses anteriores ficam preservados, e o catálogo é atualizado in-place via SCD Type 1.

## Sobrescrever caminho via env vars

Se você prefere apontar o seed pra outra pasta (sem usar este `input/`), defina as env vars:

```bash
SEED_REFERENCE_DIR=/outro/caminho/reference \
SEED_EXTRACTOR_JSON=/outro/caminho/items.json \
SEED_MAINTENANCES=/outro/caminho/maintenances.json \
bun run db:seed
```

Sem env vars, o seed lê desta pasta `input/`.
