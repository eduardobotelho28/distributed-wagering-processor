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

## Observações sobre o fluxo de desenvolvimento

Gostaria de descrever brevemente como foi o meu fluxo de desenvolvimento.

### Planejamento em tasks

Primeiro, analisei o README do desafio e dividi todo o desenvolvimento em tasks: foram **102 tasks
iniciais**, além de algumas de refactor. Separei o que deveria ser feito por mim (**HUMAN / CORE**),
que envolvia:

- decisões de arquitetura;
- idempotência;
- race conditions e locks;
- ledger;
- instalação de pacotes;
- documentação.

O restante deleguei ao **Claude**, que usei como braço direito (o README do desafio não dizia nada
sobre usar IA, então decidi usar), sempre revisando o código antes de cada PR. As tasks foram
agrupadas em branches coerentes: ao todo, cerca de **50 branches pequenas**, que foram revisadas,
mergeadas na `main` e depois excluídas.

### Pipeline de qualidade

Também configurei uma pipeline básica de desenvolvimento, com ESLint, Prettier etc., que foi
essencial para garantir a qualidade do código. Aproveitei para adicionar essa pipeline ao
**GitHub Actions**, com os testes rodando a cada PR. Isso provou, ao longo do desenvolvimento, que
os testes passavam tanto localmente quanto em outros ambientes (no caso, o GitHub), e me deu
confiança para seguir em frente após aprovar cada PR.

### Testes

O projeto conta com muitos testes: unitários, de integração, de concorrência e de carga, além do
lint. Eles estão bem organizados em pastas e arquivos, para facilitar a análise de algum teste
específico, caso seja necessário.

### Documentação

Escrevi o [ARCHITECTURE.md](ARCHITECTURE.md) com tudo o que considerei relevante sobre as
decisões, invariantes e limitações do projeto. Usei o Claude apenas para formatar o conteúdo
em Markdown e melhor organização.

### Uma nota pessoal

Também gostaria de destacar que eu não tinha muito domínio prévio de NestJS nem de MikroORM. Por
isso, talvez o código e a organização de pastas não estejam da melhor forma possível, mas entendi
que esse não era o foco da avaliação.


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

## Exemplos de requisição (Postman / Insomnia)

Os comandos abaixo são `curl` e podem ser colados direto no Postman (*Import → Raw text*) ou no
Insomnia (*Paste cURL*). Todos usam `http://localhost:3000`. A autenticação está em modo
*trust-all*, então não é preciso header `Authorization`.

> **Importante:** `WALLET_ID` é um placeholder. Depois de rodar o passo 1, substitua-o em todos os
> exemplos pelo `id` (UUID) que voltou na resposta. Enviado literalmente, a API responde
> `400 INVALID_FIELD` ("walletId must be a UUID").
>
> No Postman dá para automatizar: na aba *Scripts → Post-response* do passo 1 coloque
> `pm.collectionVariables.set("walletId", pm.response.json().id);` e use `{{walletId}}` nos demais.

### 1. Criar carteira

```sh
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{ "playerId": "player-1", "initialBalance": { "amount": "100.00", "currency": "BRL" } }'
```

`201 Created`:

```json
{ "id": "WALLET_ID", "playerId": "player-1",
  "balance": { "amount": "100.00", "currency": "BRL" }, "version": 1 }
```

Repetir com o mesmo `playerId` e moeda dá `409 WALLET_ALREADY_EXISTS`. Para recomeçar, use outro
`playerId` (e o mesmo valor nas transações, senão volta `422 PLAYER_MISMATCH`).

### 2. Aposta (BET) e replay idempotente

```sh
curl -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: bet-001" \
  -d '{
    "providerId": "prov-A", "externalTransactionId": "ext-bet-001",
    "playerId": "player-1", "walletId": "WALLET_ID",
    "roundId": "round-1", "gameId": "slots-1",
    "kind": "BET", "money": { "amount": "30.00", "currency": "BRL" }
  }'
```

`201 Created`:

```json
{ "transactionId": "…", "status": "PROCESSED",
  "balance": { "amount": "70.00", "currency": "BRL" }, "idempotentReplay": false }
```

- Mesma requisição de novo: `200 OK`, mesmo corpo com `"idempotentReplay": true`, saldo segue `70.00`.
- Mesma `Idempotency-Key` com outro valor: `409 IDEMPOTENCY_CONFLICT`.

### 3. Saldo insuficiente (rejeição de negócio)

```sh
curl -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: bet-002" \
  -d '{
    "providerId": "prov-A", "externalTransactionId": "ext-bet-002",
    "playerId": "player-1", "walletId": "WALLET_ID",
    "roundId": "round-2", "gameId": "slots-1",
    "kind": "BET", "money": { "amount": "500.00", "currency": "BRL" }
  }'
```

`422 Unprocessable Entity`:

```json
{ "transactionId": "…", "status": "REJECTED",
  "balance": { "amount": "70.00", "currency": "BRL" }, "idempotentReplay": false,
  "code": "INSUFFICIENT_FUNDS", "message": "transaction rejected by business rule", "retryable": false }
```

### 4. Estorno da aposta (ROLLBACK)

```sh
curl -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: rb-001" \
  -d '{
    "providerId": "prov-A", "externalTransactionId": "ext-rb-001",
    "playerId": "player-1", "walletId": "WALLET_ID",
    "roundId": "round-1", "gameId": "slots-1",
    "kind": "ROLLBACK", "money": { "amount": "30.00", "currency": "BRL" },
    "referenceExternalTransactionId": "ext-bet-001"
  }'
```

`201 Created` com `"status": "PROCESSED"` e saldo de volta a `"100.00"`.

- Segundo estorno da mesma aposta (outra key/externalId): `422 REFERENCE_ALREADY_REVERSED`.
- Referência que ainda não chegou (ex.: `"ext-bet-999"`): `202 Accepted`, `"status": "PENDING_REFERENCE"`, `"balance": null`.
- Sem `referenceExternalTransactionId`: `400 REFERENCE_REQUIRED`.
- `"kind": "OPENING"`: `400 OPENING_NOT_ALLOWED`.

### 5. Saldo, ledger e reconciliação

```sh
curl http://localhost:3000/wallets/WALLET_ID
curl "http://localhost:3000/wallets/WALLET_ID/ledger?limit=10"
curl -X POST http://localhost:3000/wallets/WALLET_ID/reconciliation
```

Reconciliação, `200 OK`:

```json
{ "walletId": "WALLET_ID",
  "storedBalance":     { "amount": "100.00", "currency": "BRL" },
  "calculatedBalance": { "amount": "100.00", "currency": "BRL" },
  "difference":        { "amount": "0.00",   "currency": "BRL" },
  "consistent": true, "checkedEntries": 3 }
```

O ledger traz 3 lançamentos (abertura +100, débito de 30, crédito de 30), cada um com
`balanceBefore` e `balanceAfter`. Também dá para consultar uma transação por id
(`GET /wagering/transactions/<id>`) ou pelo id externo
(`GET /providers/prov-A/wagering/transactions/ext-bet-001`).
