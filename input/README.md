# input/

Pasta de onde o seed (`bun run db:seed`) lê os JSONs gerados pelo `sinapi-extractor`. Espelha exatamente a estrutura de `sinapi-extractor/output/`:

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

**Caminho recomendado** — atalho que faz tudo:

```bash
bun run import:month 2026-04
```

Esse comando roda o `sinapi-extractor`, copia os JSONs gerados pra cá e em seguida roda o seed. Você só precisa ter os arquivos em `../sinapi-extractor/input/` (ver README de lá).

**Caminho manual** — útil se você gerou os JSONs em outra máquina e quer só popular o banco aqui:

```bash
cp -r ../sinapi-extractor/output/reference  input/reference
cp    ../sinapi-extractor/output/maintenances.json  input/maintenances.json
cp    ../sinapi-extractor/output/items.json         input/items.json
bun run db:seed
```

## Sobrescrever caminho via env vars

Se você prefere apontar o seed pra outra pasta (sem usar este `input/`), defina as env vars:

```bash
SEED_REFERENCE_DIR=/outro/caminho/reference \
SEED_EXTRACTOR_JSON=/outro/caminho/items.json \
SEED_MAINTENANCES=/outro/caminho/maintenances.json \
bun run db:seed
```

Sem env vars, o seed lê desta pasta `input/`.
