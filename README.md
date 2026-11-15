# Distributed Wagering Processor

Olá! Sou o Eduardo Botelho, e este repositório é a minha solução para o desafio técnico da
**Jungle Gaming**. Foi um prazer enorme fazer esse desafio: o problema é bem real (dinheiro,
concorrência, mensagens duplicadas, falhas no meio do caminho) e me deu a chance de aplicar com
cuidado várias práticas de que gosto muito. Obrigado pela oportunidade!

## O que é

Um serviço que processa transações de apostas (BET, WIN, LOSS, REFUND, ROLLBACK) recebidas por
**HTTP** e por **SQS**. O saldo é calculado em decimal exato, a idempotência é garantida pelo
banco e há lock por carteira, ledger append-only e transactional outbox. Várias instâncias podem
rodar em paralelo com segurança.

**Stack:** Bun · TypeScript · NestJS · PostgreSQL 16 · MikroORM · AWS SQS (LocalStack) · Docker Compose

As decisões de arquitetura, as invariantes e as limitações estão em [ARCHITECTURE.md](ARCHITECTURE.md),
e o teste de carga está em [LOAD_TEST.md](LOAD_TEST.md).

## Como rodar

O único pré-requisito é **Docker** com Compose v2. Não é preciso instalar Bun, Node nem Postgres.

```sh
git clone https://github.com/eduardobotelho28/distributed-wagering-processor.git
cd distributed-wagering-processor
cp .env.example .env
docker compose up
```

Esse comando sobe o Postgres, o LocalStack (com as filas já criadas) e a aplicação na porta **3000**.
As migrations são aplicadas automaticamente. Para conferir se a aplicação está pronta:

```sh
curl -s localhost:3000/health/ready
# {"status":"ready","checks":{"database":"up","sqs":"up"}}
```

> O `docker compose up` só sobe a aplicação e **não roda os testes**. Para rodá-los, veja a seção abaixo.

## Como rodar os testes

Todos os testes rodam dentro do container, com Postgres e LocalStack reais (nada é mockado).
Com o `docker compose up` rodando, abra outro terminal:

```sh
docker compose exec app bun test                  # tudo (~2min)

docker compose exec app bun run test:unit         # unitários (segundos)
docker compose exec app bun run test:integration  # integração com Postgres + SQS reais (~40s)
docker compose exec app bun run test:concurrency  # várias instâncias reais do app em paralelo (~70s)
docker compose exec app bun run test:load         # teste de carga (~2min)

docker compose exec app bun run lint              # ESLint + Prettier
docker compose exec app bun run typecheck         # tsc strict
```

Se a stack não estiver no ar, troque `exec` por `run --rm`. O Compose sobe o Postgres e o
LocalStack antes de rodar o comando:

```sh
docker compose run --rm app bun test
```

Cada suíte cria o próprio banco e as próprias filas temporárias, então os testes não interferem
nos dados da aplicação em execução.
