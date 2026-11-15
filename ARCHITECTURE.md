# Arquitetura

Este documento explica **por que** o sistema é como é: as decisões e as alternativas rejeitadas,
onde cada invariante financeira é garantida e qual teste a prova, os códigos de falha e as
limitações conhecidas. Como subir e usar o sistema está no [README](README.md).

Sumário:

1. [Visão geral](#1-visão-geral)
2. [Decisões](#2-decisões)
3. [Invariantes, códigos de falha e transições](#3-invariantes-códigos-de-falha-e-transições)
4. [Autenticação](#4-autenticação)
5. [Limitações e trade-offs](#5-limitações-e-trade-offs)
6. [Checklist eliminatória](#6-checklist-eliminatória)

---

## 1. Visão geral

```
            HTTP POST /wagering/transactions            SQS wager-transactions.fifo
                         │                                (grupo FIFO = walletId)
                         ▼                                          │
              validação na borda (400)                    parse + inbox (dedupe)
                         │                                          │
                         └──────────────┬───────────────────────────┘
                                        ▼
                     WagerSubmission (mesmo código nos dois canais)
        ┌────────────────────── UMA transação SQL ──────────────────────┐
        │ SELECT wallet FOR UPDATE → busca idempotency key → regra →    │
        │ wager_transactions + wallet_ledger_entries + wallets.balance  │
        │ + outbox_messages (+ inbox_messages.processed_at, se SQS)     │
        └───────────────────────────────────────────────────────────────┘
                                        │ commit, só então ack/resposta
                   ┌────────────────────┴────────────────────┐
                   ▼                                          ▼
      publisher do outbox (SKIP LOCKED)          worker de PENDING_REFERENCE (SKIP LOCKED)
                   │                                          │
                   ▼                                          ▼
          SQS wager-events (at-least-once)         reprocessa / reagenda / expira
```

Camadas (dependências só apontam para dentro, verificado pelo lint em
`test/lint/layer-boundaries.test.ts`):

| Camada | Conteúdo | Não pode importar |
|---|---|---|
| `domain` | `Money`, `Wallet`, `WalletLedgerEntry`, `WagerTransaction`, política de reversão, eventos | Nest, MikroORM, qualquer outra camada |
| `application` | casos de uso, ports, processador compartilhado de transações | `infrastructure`, `interfaces` |
| `infrastructure` | MikroORM, migrations, adapter SQS, logger, métricas, health checks | — |
| `interfaces` | HTTP, consumidor SQS, workers, módulos Nest | — |

HTTP e SQS chamam **o mesmo** núcleo (`src/application/wager-processing/wager-submission.ts`).
A única diferença é o que envolve a transação: o consumidor acrescenta o inbox dentro dela.

---

## 2. Decisões

### 2.1 ORM: MikroORM

Escolhido em vez de TypeORM ou SQL puro por três motivos: `em.transactional` delimita a
transação de forma explícita; `LockMode.PESSIMISTIC_WRITE` gera o `SELECT … FOR UPDATE` e
`PESSIMISTIC_PARTIAL_WRITE` o `FOR UPDATE SKIP LOCKED`, que o modelo de concorrência exige; e
`defineEntity` permite modelos sem decorators, isolados em `infrastructure`.

Modelos de persistência **não** são o domínio: mappers convertem linha ↔ agregado via
`rehydrate` (`src/infrastructure/persistence/mappers/`). Leituras ignoram o identity map e
escritas são nativas (`nativeUpdate`/`insert`), porque o agregado em memória é a fonte do
estado e um modelo cacheado pelo ORM só abriria espaço para dado velho. As migrations são
escritas à mão (sem snapshot) e todas têm `down`; há teste de ida-volta-ida em banco vazio.

### 2.2 Dinheiro

- Domínio: `Money` sobre `decimal.js` (precisão 40, sem notação científica), no máximo 2 casas,
  nunca negativo na entrada. Operações entre moedas diferentes lançam erro: comparar BRL com
  USD é bug de quem chama.
- Banco: `NUMERIC(19,2)` + `currency CHAR(3)`. O driver devolve `numeric` como string e
  `Money.from` recusa qualquer não-string, então um número nunca entra no domínio.
- JSON: sempre `{ "amount": "25.00", "currency": "BRL" }`. Número JSON no `amount` é 400.
- Lint proíbe `parseFloat`, `Number()` e `toFixed` em `src/` (`test/lint/money-float-ban.test.ts`).
- Somas do ledger são feitas no banco e devolvidas como texto, separadas em créditos e débitos
  (ambos ≥ 0); a diferença é calculada em `Money`.
- A moeda da carteira vem do saldo inicial; não há um campo de moeda separado que possa divergir.

### 2.3 Transação e unidade de trabalho

Tudo que muda estado numa submissão roda numa **única** transação SQL
(`MikroOrmUnitOfWork`, um fork do `EntityManager` por unidade): transação, lançamento no ledger,
saldo da carteira, evento no outbox e, se veio do SQS, o inbox. Ou tudo é confirmado, ou nada.
Rejeições de negócio também são gravadas (auditáveis, e o replay responde igual). Há teste de
rollback conjunto das cinco tabelas.

### 2.4 Concorrência: lock pessimista por carteira

**Escolhido:** `SELECT … FOR UPDATE` na linha da carteira, dentro da transação, **antes** da
busca pela idempotency key. A unidade de concorrência é a carteira; não existe lock global.

**Por que antes da busca:** duas entregas da mesma key para a mesma carteira serializam no
lock; a segunda só procura a key depois que a primeira commitou, então encontra a transação
gravada e vira replay. Buscar antes do lock abriria a janela "as duas não acham, as duas
processam".

**Alternativas rejeitadas:**

| Alternativa | Por que não |
|---|---|
| Lock otimista com `version` e retry | Uma carteira concorrida (o cenário de apostas) queima retries; com 50 requisições simultâneas a maioria falharia e repetiria. O lock serializa sem desperdício e é simples de raciocinar. |
| `UPDATE … SET balance = balance - x WHERE balance >= x` | Resolve o saldo, mas não o resto da decisão (idempotência, regra de reversão, ledger com `balance_before`), que precisa de um estado lido e estável. |
| Lock global / fila única por processo | Mata o paralelismo entre carteiras diferentes e não funciona com várias instâncias. |
| Advisory lock do Postgres | Funciona, mas é um segundo mecanismo de coordenação fora da linha que já precisa ser travada. |

**Espera limitada:** cada transação roda com `SET LOCAL lock_timeout` (padrão 10s,
`DATABASE_LOCK_TIMEOUT_MS`). Sem limite, uma carteira presa (transação travada, conexão
pendurada) seguraria todas as requisições dela até esgotar o pool. Estourado, o Postgres
devolve `55P03`, que é transitório: 503 + `Retry-After` no HTTP, retry com backoff no SQS, e
conta em `lock_conflicts_total{kind="lock_timeout"}`. O valor é bem maior que a fila normal de
uma carteira quente (50 apostas simultâneas em 3 instâncias passam com folga).

O `version` da carteira existe e é incrementado a cada movimentação, mas como contador, não
como mecanismo de concorrência. A reconciliação também lê com a carteira travada: em READ
COMMITTED, duas leituras sem lock poderiam ver commits diferentes e acusar divergência falsa.

### 2.5 Idempotência

- **Fonte da verdade:** o banco. `UNIQUE (idempotency_key)` e `UNIQUE (provider_id,
  external_transaction_id)`. Nenhum cache em memória participa da decisão.
- **Key:** header `Idempotency-Key` no HTTP (obrigatório; não é derivado do corpo) e
  `data.idempotencyKey` na mensagem SQS.
- **Hash do payload** (`src/domain/transaction/payload-hash.ts`):
  1. só os campos de negócio: `providerId`, `externalTransactionId`, `playerId`, `walletId`,
     `roundId`, `gameId`, `kind`, `money` (headers e atributos de transporte ficam fora, para
     reentregas darem o mesmo hash);
  2. `money` como JSON decimal (`{ amount: "10.00", currency }`), nunca número;
  3. JSON canônico: chaves ordenadas em todos os níveis, sem espaços;
  4. SHA-256 dos bytes UTF-8, hex minúsculo.
- **Mesma key + mesmo hash** → replay com o resultado original, inclusive o saldo da época
  (`resulting_balance` gravado na linha), com `idempotentReplay: true`. Replay de REJECTED
  responde 422 de novo. Replay não emite eventos.
- **Mesma key + outro hash** → `409 IDEMPOTENCY_CONFLICT`; nada é gravado.
- **Mesmo `(providerId, externalTransactionId)` sob outra key** → `409
  EXTERNAL_TRANSACTION_ID_CONFLICT` (no SQS, DLQ com esse código); nada é gravado. A key decide
  o replay; duas keys para a mesma operação do provedor são erro do cliente. Sob corrida, o
  `UNIQUE (provider_id, external_transaction_id)` decide e a perdedora relê numa transação nova.
- **Corrida entre carteiras:** a mesma key enviada ao mesmo tempo para duas carteiras não
  serializa no lock (são linhas distintas). O `UNIQUE` decide: a perdedora tem a transação
  abortada, e relemos a key numa transação nova. O Postgres só acusa a violação depois que a
  vencedora commitou, então a releitura sempre a encontra.

### 2.6 Inbox (SQS)

Dedup por `(consumer_name, message_id)` como chave primária, com `INSERT … ON CONFLICT DO
NOTHING`, **na mesma transação** do efeito financeiro e do `markProcessed`. Por isso "já existe"
sempre significa "já processado": se o processo morrer antes do commit, nada fica e a
reentrega processa do zero; depois do commit, a reentrega vira duplicata e recebe ack sem
efeito. O `messageId` usado é o de negócio (do corpo), não o id de transporte do SQS, que muda
se o provedor reenviar.

### 2.7 Outbox e publicação

Eventos são gravados no outbox na transação do efeito; nada é publicado antes do commit. O
publisher trava um lote com `FOR UPDATE SKIP LOCKED`, envia ao SQS e marca como publicado **na
mesma transação**.

**Entrega at-least-once, deliberadamente.** Se o processo morrer depois do envio e antes do
commit, a marcação some e outra instância republica: o evento pode chegar duas vezes, nunca
zero. Exactly-once exigiria transação distribuída entre Postgres e SQS. O consumidor deduplica
pelo `eventId`, e as cópias são byte a byte idênticas (teste `two-publishers-crash`).

`SKIP LOCKED` é a única coordenação entre N publishers: cada um pega linhas disjuntas, sem
eleição de líder. Falha de envio afeta só aquele evento (backoff próprio); o resto do lote segue.

### 2.8 Interpretação da reversão

Uma referência pode ser revertida **no máximo uma vez no total**, por qualquer REFUND ou
ROLLBACK. Garantido por índice único parcial em `wager_transactions (reference_transaction_id)
WHERE status = 'PROCESSED'`; a consulta prévia no caso de uso só transforma a violação em
`REJECTED` auditável. Rejeitadas e pendentes não contam.

- REFUND só reverte BET (crédito). ROLLBACK reverte BET, WIN ou REFUND, sempre na **direção
  inversa** da referência.
- A política (`src/domain/transaction/reversal-policy.ts`) checa nesta ordem fixa: tipo, status
  da referência, mesmo provedor/jogador/carteira/rodada, moeda, valor igual. A falha mais
  estrutural aparece primeiro.
- Rollback que deixaria o saldo negativo é `REJECTED` com `REVERSAL_WOULD_OVERDRAW`.
- Referência ausente ou ainda pendente → a reversão vira `PENDING_REFERENCE` (seção 2.11).
- LOSS não gera lançamento: o débito já ocorreu no BET. Ainda assim é `PROCESSED` e emite
  `WagerTransactionProcessed`.

### 2.9 Mapeamento HTTP

Mesmo mapeamento em todos os endpoints; corpo de erro `{ code, message, retryable }`, e
`retryable` é a única coisa que o provedor precisa ler para decidir reenviar.

| Situação | Status | `retryable` |
|---|---|---|
| processado / replay idêntico | 201 / 200 | — |
| referência pendente | 202 | — |
| payload inválido, header ausente, id malformado | 400 | false |
| não encontrado | 404 | false |
| conflito de idempotência, id externo sob outra key, carteira duplicada | 409 | false |
| rejeição de negócio (também no replay) | 422 | false |
| `FAILED` (erro interno permanente) | 500 | false |
| falha transitória (conexão, deadlock, lock timeout, serialização, pool esgotado) | 503 + `Retry-After: 1` | **true** |

422 e 500 trazem também os campos da transação, para o provedor guardar o `transactionId`. Id
malformado na URL é 400, não 404 (o cliente errou o formato). Mensagens de erro citam só o nome
do campo, nunca o valor recebido.

### 2.10 Classificação de mensagens SQS

| Situação | Classe | Ação |
|---|---|---|
| processed, rejected, pendingReference | negócio | ack (depois do commit) |
| duplicata no inbox | negócio | ack, sem efeito |
| exceção (banco fora, deadlock, lock timeout, erro inesperado) | transitória | sem ack; visibilidade com backoff |
| exceção no limite de recebimentos | esgotada | grava `FAILED` (se possível) + DLQ com motivo + ack |
| malformada, payload inválido, OPENING | permanente | DLQ com motivo + ack |
| conflito de idempotência ou de id externo, `FAILED` já gravado | permanente | DLQ com motivo + ack |

Exceção inesperada é tratada como transitória: repetir até o limite custa poucas tentativas, e
tratá-la como permanente mandaria para a DLQ algo que um restart do banco resolveria. A
mensagem vai para a DLQ **antes** do ack do original; se o processo morrer entre os dois, o
`MessageDeduplicationId` da FIFO descarta a cópia. O envelope da DLQ leva `code`, `reason`,
`receiveCount`, `failedAt` e o corpo original. Mensagens do lote são tratadas em sequência,
para preservar a ordem FIFO do grupo (`walletId`).

Erro de domínio no meio do processamento (bug determinístico) vira `FAILED` com
`INTERNAL_PERMANENT_ERROR`, gravado numa transação nova, para o provedor ter resposta terminal e
o replay ser estável. Erro de driver/conexão nunca vira `FAILED`: sobe como transitório.

### 2.11 Backoff e limites

| O quê | Valor | Por quê |
|---|---|---|
| Reprocessamento de `PENDING_REFERENCE` | 5s, dobrando, teto 5min; **8 tentativas ou TTL de 1h** | Referência fora de ordem costuma chegar em segundos; 8 tentativas somam ~15min; o TTL limita o caso de backlog. Esgotado: `REJECTED` com `REFERENCE_NOT_FOUND` + evento. |
| Retry de publicação do outbox | 1s, dobrando, teto 5min | Espalha retries numa queda do SQS sem fazer um broker recuperado esperar demais. |
| Visibilidade de mensagem SQS em falha transitória | 5s, dobrando, teto 5min | Falha transitória de banco dura segundos; dobrar evita martelar o banco na volta. |
| Limite de recebimentos antes da DLQ | 5 | Igual ao `maxReceiveCount` do `RedrivePolicy`: o app move com motivo antes que o SQS mova sem. |
| Long polling do consumidor | 2s | Limita quanto o shutdown espera um receive em curso. |
| Página do ledger | padrão 50, máximo 200 | Protege o banco de varreduras grandes. |
| Timeout de cada health check | 2s | Readiness probes costumam ter timeout de poucos segundos. |

Tudo que é tempo é injetado por `Clock`, então os testes avançam o relógio em vez de esperar.

### 2.12 Workers, shutdown e várias instâncias

- Cada instância roda HTTP, consumidor, publisher e worker de pendências. Não há eleição de
  líder: `SKIP LOCKED` divide o trabalho. Testado com 2 e 3 processos reais.
- Workers fazem rodada → espera → rodada (não `setInterval`): nunca há duas rodadas sobrepostas
  no mesmo processo.
- O reprocessamento trava a linha da transação e depois a carteira. Não há ciclo com a
  submissão, que trava a carteira e nunca trava linhas `PENDING_REFERENCE`.
- No SIGTERM: o consumidor para de buscar, termina a mensagem em andamento e devolve as não
  iniciadas (visibilidade 0); os workers terminam a rodada atual. Isso roda em
  `beforeApplicationShutdown`, antes de o MikroORM fechar as conexões.

### 2.13 Identificadores e detalhes do modelo

- Ids são **UUID v7** gerados pela aplicação (`Bun.randomUUIDv7`): ordenáveis pelo tempo, sem
  `DEFAULT` no banco, sem dependência nova.
- O id do lançamento no ledger é o id da transação: cada transação move o saldo no máximo uma
  vez (`UNIQUE (wallet_id, transaction_id)`).
- Saldo inicial > 0 vira uma transação interna `OPENING` (`PROCESSED`) com lançamento CREDIT,
  na mesma transação da criação da carteira; assim saldo = soma do ledger desde o primeiro
  instante. `OPENING` só nasce por um factory interno; HTTP e SQS a recusam com 400/DLQ.
- `wager_transactions` não tem FK para `wallets`: rejeições com `WALLET_NOT_FOUND` também são
  gravadas para o replay idempotente.
- `rehydrate` nunca revalida transições: o estado vem do banco, que já passou por `create`.

### 2.14 Observabilidade

- Logs JSON, uma linha por evento, com contexto em `AsyncLocalStorage` (`correlationId`,
  `messageId`, `transactionId`, `walletId`, `providerId`). O `correlationId` nasce no HTTP
  (header ou gerado) ou é o `messageId` no SQS, vai para o envelope do evento e reaparece no log
  do publisher, ligando requisição → outbox → publicação.
- Redação por **lista de campos permitidos**: campo fora da lista é descartado. Payloads e
  valores monetários não vão para o log; a única exceção deliberada é a diferença da
  reconciliação, que o enunciado pede para logar.
- Métricas Prometheus em `GET /metrics`: transações por status e canal, duplicatas (inbox e
  key), retries por tipo, DLQ por código, conflitos de lock (deadlock, serialização e
  `lock_timeout`), **tempo de espera pelo lock da carteira** (`wallet_lock_wait_seconds`, o sinal
  de carteira disputada mesmo quando nada falha), lag do outbox, latência de processamento e
  divergências de reconciliação. Nomes e labels são uniões fechadas no código.
- `/health/live` não toca dependências; `/health/ready` faz `select 1` e `GetQueueUrl` reais.

### 2.15 Decisões menores

- **Boot falha cedo:** toda variável de ambiente é validada antes do Nest subir, e todas as
  falhas são listadas de uma vez, sem ecoar valores (a `DATABASE_URL` tem senha). O boot também
  falha se o Postgres não responder, em vez de subir a API e quebrar na primeira requisição.
- **Migrations no boot do container:** o compose roda `migration:up` antes do app, para um clone
  novo funcionar só com `docker compose up`. O CLI usa a mesma validação de env do app.
- **Injeção por token:** casos de uso são classes puras da `application`; o Nest só os
  instancia, com `@Inject(token)` explícito em vez de depender de metadata de tipos.
- **Envelope do evento:** `causationId` é `null` quando não há causa (requisição HTTP), em vez
  de ausente, para o consumidor sempre encontrar a chave. `data` só aceita tipos serializáveis
  (`MoneyJSON` com strings), nunca a instância de `Money`.
- **`correlationId` do header:** só é aceito com formato seguro para log (até 128 caracteres
  `[\w.:-]`); fora disso é gerado, em vez de rejeitar a requisição por um header de rastreio.
- **Cache de URL de fila:** o adapter guarda nome → URL só para não repetir `GetQueueUrl`; não
  participa de dedup nem de idempotência. O health check não usa esse cache.
- **Cursor do extrato:** base64url de `createdAt|id`, opaco para o cliente; paginação keyset
  (sem `OFFSET`), então páginas não duplicam nem pulam lançamentos que chegam durante a navegação.
- **Credenciais AWS:** pela cadeia padrão do SDK (variáveis no LocalStack, role na AWS); nada de
  chave no código.

---

## 3. Invariantes, códigos de falha e transições

### 3.1 Matriz de invariantes

Cada invariante tem pelo menos uma barreira no código **e**, quando cabe, uma no banco. A
última coluna é o teste que prova.

| Invariante | Garantia no código | Garantia no banco | Teste que prova |
|---|---|---|---|
| Saldo nunca negativo | `Wallet.debit` (`InsufficientFundsError`); processador rejeita antes de debitar | `CHECK (balance >= 0)` em `wallets`; `CHECK (balance_after >= 0)` no ledger | `test/unit/application/submit-wager-transaction/bet.test.ts`, `test/integration/persistence/constraints.test.ts`, `test/concurrency/hot-wallet-mixed-load.test.ts` |
| Saldo == soma do ledger | toda movimentação grava lançamento + saldo na mesma transação | — | `assertLedgerInvariant` em todo teste de integração e concorrência; `test/integration/support/ledger-invariant.test.ts` |
| Lançamento balanceado (`after = before ± amount`) | `WalletLedgerEntry.create` | `wallet_ledger_entries_balanced_check` | `test/unit/domain/wallet/wallet-ledger-entry.test.ts`, `constraints.test.ts` |
| Ledger append-only | repositório só tem `insert` | trigger que barra `UPDATE` e `DELETE` | `test/integration/persistence/wallet-ledger-entries.migration.test.ts` |
| Valor de lançamento > 0 | `WalletLedgerEntry.create`; validação na borda | `wallet_ledger_entries_amount_positive` | `constraints.test.ts`, `boundary-and-failures.test.ts` |
| Dinheiro nunca é float | `Money.from` só aceita string; lint proíbe float em `src/` | `NUMERIC(19,2)` | `test/unit/domain/money/*.test.ts`, `test/lint/money-float-ban.test.ts`, `test/integration/persistence/money-columns.test.ts` |
| Uma transação por idempotency key | lock antes da busca; releitura na corrida | `wager_transactions_idempotency_key_unique` | `test/concurrency/same-bet-50x.test.ts`, `test/integration/application/idempotency-key-race.test.ts` |
| Um par provedor + id externo | busca antes do insert; violação vira `409 EXTERNAL_TRANSACTION_ID_CONFLICT` | `wager_transactions_provider_external_unique` | `constraints.test.ts`, `external-id-conflict.test.ts`, `idempotency-key-race.test.ts` |
| Transação só move a carteira do próprio jogador | processador rejeita com `PLAYER_MISMATCH` antes de qualquer movimento | — | `player-ownership.test.ts`, `submit-transaction.e2e.test.ts` |
| Uma movimentação por transação | id do lançamento = id da transação | `wallet_ledger_entries_wallet_transaction_unique` | `constraints.test.ts` |
| Reversão única por referência | `findProcessedReversalOf` → `REFERENCE_ALREADY_REVERSED` | índice único parcial em `reference_transaction_id` | `test/concurrency/concurrent-reversals.test.ts`, `test/concurrency/reversal-before-reference.test.ts`, `single-reversal-per-reference.migration.test.ts` |
| REFUND/ROLLBACK exigem referência | `WagerTransaction.create`; validação na borda | `wager_transactions_reversal_reference_check` | `boundary-and-failures.test.ts`, `constraints.test.ts` |
| OPENING nunca vem de fora | `WagerTransaction.create`; parsers HTTP e SQS; `validateSubmission` | — | `request-validation.test.ts`, `wager-message.parser.test.ts`, `boundary-and-failures.test.ts` |
| Uma carteira por jogador e moeda | `WalletAlreadyExistsError` → 409 | `wallets_player_id_currency_unique` | `test/integration/application/create-wallet.test.ts` (corrida de 3), `constraints.test.ts` |
| Mensagem SQS processada no máximo uma vez | inbox na mesma transação do efeito | PK `(consumer_name, message_id)` | `test/concurrency/killed-before-ack.test.ts`, `consume-wager-message.test.ts` |
| Ack só depois do commit | `apply` só roda depois de `consume.execute` retornar | — | `wager-message.consumer.test.ts` ("ack happens only after the use case committed") |
| Evento só existe se o efeito commitou | outbox gravado na mesma transação | — | `test/integration/persistence/mikro-orm-unit-of-work.test.ts` (rollback conjunto) |
| Nenhum evento perdido | publicação at-least-once; retry por evento | índice parcial de pendentes | `two-publishers-crash.test.ts`, `workers.test.ts`, `outages.test.ts` |
| Sem bloqueio entre carteiras | lock por linha de carteira | — | `test/concurrency/different-wallets.test.ts` |
| Nada se perde em queda ou reinício | transação única + inbox + ack após commit | — | `restart-consistency.test.ts`, `outages.test.ts`, `graceful-shutdown.test.ts` |
| Divergência nunca corrigida em silêncio | reconciliação só reporta, loga e conta | — | `reconcile-wallet.use-case.test.ts`, `reconciliation.e2e.test.ts` |

### 3.2 Códigos de falha

`FailureCode` é estável: é persistido, exposto na API (422) e vai nos eventos.

**Sobre reenviar:** pela regra de idempotência, reenviar **a mesma** idempotency key devolve
sempre o mesmo resultado (replay). Onde a tabela diz "tentar de novo", o provedor precisa
mandar uma **transação nova**, com outro `externalTransactionId` e outra key, porque o par
`(providerId, externalTransactionId)` também é único.

| Código | Quando | Orientação ao provedor |
|---|---|---|
| `INSUFFICIENT_FUNDS` | débito maior que o saldo | Nova transação só depois de um crédito na carteira. |
| `REVERSAL_WOULD_OVERDRAW` | rollback de crédito deixaria saldo negativo | Não repetir; tratar manualmente. |
| `REFERENCE_NOT_FOUND` | referência não chegou dentro de 8 tentativas / 1h | Enviar a referência e depois uma nova reversão. |
| `REFERENCE_ALREADY_REVERSED` | a referência já foi revertida uma vez | Desistir; nunca terá sucesso. |
| `REFERENCE_MISMATCH` | provedor, jogador, carteira ou rodada diferem da referência | Corrigir o payload. |
| `PLAYER_MISMATCH` | `playerId` do payload não é o dono da carteira | Corrigir o payload. |
| `INVALID_REFERENCE_KIND` | tipo da referência não pode ser revertido por este tipo | Corrigir o payload. |
| `REFERENCE_NOT_PROCESSED` | a referência existe mas foi rejeitada | Desistir; referência rejeitada não se reverte. |
| `AMOUNT_MISMATCH` | valor da reversão difere da referência | Corrigir o payload. |
| `CURRENCY_MISMATCH` | moeda difere da carteira ou da referência | Corrigir o payload. |
| `WALLET_NOT_FOUND` | carteira inexistente | Corrigir o payload. |
| `REFERENCE_REQUIRED` | REFUND/ROLLBACK sem referência | Corrigir o payload. Não é gravado: volta como 400 (o banco proíbe gravar reversão sem referência). |
| `INTERNAL_PERMANENT_ERROR` | bug determinístico; status `FAILED` (500) | Desistir e acionar suporte. |

Todos os códigos são produzidos por pelo menos um teste em `test/unit/application/`.

### 3.3 Transições de `WagerTransaction`

| De \ Para | `PROCESSED` | `PENDING_REFERENCE` | `REJECTED` | `FAILED` |
|---|---|---|---|---|
| `PENDING` (só em memória) | ✔ | ✔ | ✔ | ✔ |
| `PENDING_REFERENCE` | ✔ referência resolvida | ✘ (reagenda sem mudar o status) | ✔ política ou `REFERENCE_NOT_FOUND` | ✔ |
| `PROCESSED`, `REJECTED`, `FAILED` | terminais: qualquer transição lança `InvalidTransactionStateError` | | | |

`PENDING` nunca é commitado: toda transação sai da submissão já num estado final ou em
`PENDING_REFERENCE`. Testado em `test/unit/domain/transaction/wager-transaction-transitions.test.ts`.

---

## 4. Autenticação

**Decisão: não implementada neste desafio**, como o enunciado (§2) permite. Ela não vale pontos e
competiria em tempo com correção financeira, concorrência e idempotência. O ponto de extensão,
porém, está no código e ligado.

### O que existe no código

| Peça | Onde | Papel |
|---|---|---|
| `ProviderIdentityPort` | `src/application/ports/provider-identity.ts` | Resolve a identidade do provedor a partir das credenciais da requisição. `null` = não autenticado. |
| `TrustAllProviderIdentity` | `src/infrastructure/auth/trust-all-provider-identity.ts` | Implementação no-op: toda requisição recebe uma identidade sem restrição de provedor. |
| `AuthGuard` | `src/interfaces/http/auth/auth.guard.ts` | Guard **global** (`APP_GUARD`). Rota nova nasce protegida; só fica aberta com `@Public()`. Sem identidade, responde `401 UNAUTHENTICATED`. |
| `@Public()` | `src/interfaces/http/auth/public.decorator.ts` | Usado nos endpoints de health e em `/metrics`. |

### Desenho que seria adotado

- **IdP externo:** Keycloak com OIDC, em um container do Docker Compose. Cada provedor de jogos
  é um *client* com `client_credentials` (comunicação máquina a máquina, sem usuário humano).
- **Token:** JWT de acesso assinado (RS256). A API valida assinatura via JWKS do realm (com
  cache), `iss`, `aud` e `exp`. Nenhuma tabela própria de usuários ou senhas.
- **Identidade do provedor:** um claim do token (ex.: `provider_id`, mapeado no client do
  Keycloak) vira o `providerId` da `ProviderIdentity`.
- **Regra de autorização:** no `POST /wagering/transactions`, o `providerId` do corpo **precisa**
  ser igual ao do token; divergência responde `403`. Nas consultas por provedor, o mesmo vale
  para o `:providerId` da URL. Isso impede que um provedor grave ou leia transações de outro.
- **Troca:** ligar a autenticação é substituir `TrustAllProviderIdentity` por uma implementação
  OIDC no `HttpModule` e adicionar a checagem de `providerId` no controller de transações.

### Fora do escopo da autenticação

- Endpoints de health ficam abertos.
- Mensagens da fila SQS são tratadas como canal interno confiável. A identidade do provedor
  contida na mensagem continua sujeita às mesmas validações de domínio (referência do mesmo
  provedor, mesma carteira e rodada).

---

## 5. Limitações e trade-offs

### 5.1 Vazão de uma carteira concorrida

O lock pessimista serializa **todas** as movimentações de uma mesma carteira, inclusive entre
instâncias. Carteiras diferentes escalam linearmente (testado), mas uma carteira muito
disputada fica limitada a uma movimentação por vez, ao custo de uma transação curta cada. Para
iGaming é aceitável (uma carteira é de um jogador), mas um "jackpot compartilhado" exigiria
outro desenho, como agregar créditos em lote ou particionar o saldo.

### 5.2 Ordem do ledger depende do relógio da instância

O extrato e o encadeamento verificado pelo checker ordenam por `(created_at, id)`, e o
`created_at` vem do relógio de quem processou. Dentro de uma instância a ordem é correta (o lock
serializa e o relógio avança). Com várias instâncias em máquinas dessincronizadas, dois
lançamentos da mesma carteira podem receber `created_at` fora da ordem real do lock. O saldo e a
soma continuam corretos (a reconciliação não acusa nada), mas o extrato pode sair fora de ordem e
o encadeamento `balance_before → balance_after` aparenta quebra.

- **Mitigação adotada:** nenhuma no código; depende de NTP nas instâncias, o padrão em qualquer
  ambiente gerenciado.
- **Correção possível:** gravar em cada lançamento a versão da carteira (número de sequência já
  incrementado sob o lock) com `UNIQUE (wallet_id, wallet_version)` e ordenar extrato e cursor
  por ela. Exige migration e mudança no cursor opaco.

### 5.3 Tabelas crescem sem limite

`wager_transactions`, `wallet_ledger_entries`, `outbox_messages` e `inbox_messages` só crescem.
Os índices parciais mantêm baratas as varreduras dos workers (só pendentes), mas não há
arquivamento nem limpeza do outbox publicado e do inbox antigo. Em escala: particionar
`wallet_ledger_entries` e `wager_transactions` por tempo (ou por hash da carteira), e um job que
apaga outbox publicado e inbox mais velhos que a janela de reentrega do SQS.

### 5.4 Reconciliação trava a carteira durante a soma

Para não acusar divergência falsa, a reconciliação soma o ledger com o lock da carteira. Numa
carteira com milhões de lançamentos isso bloquearia as apostas durante a soma. Em escala: um
saldo de checkpoint por período (soma até o último checkpoint + lançamentos depois dele), ou
reconciliar a partir de uma réplica num ponto consistente.

### 5.5 Correlação perdida no reprocessamento

O `correlationId` da requisição original não é gravado no banco. Eventos emitidos pelo worker de
`PENDING_REFERENCE` (minutos depois) correlacionam pelo id da transação, não pelo id da
requisição que a criou. Correção: uma coluna `correlation_id` em `wager_transactions`.

### 5.6 Consumidor processa uma mensagem por vez por instância

Para preservar a ordem FIFO por carteira e deixar no máximo uma mensagem em andamento no
shutdown, cada instância trata o lote em sequência. A vazão do SQS escala com o número de
instâncias (o SQS distribui os grupos), não com concorrência dentro do processo. Uma melhoria
seria processar grupos diferentes em paralelo dentro do mesmo lote.

### 5.7 Vazão do publisher do outbox

Medido no teste de carga ([LOAD_TEST.md](LOAD_TEST.md)): o caminho de escrita sustenta ~280
apostas/s (~560 eventos/s) nesta máquina, mas o publisher, na configuração padrão, drena ~100 a
150 eventos/s, porque cada instância envia no máximo 50 por rodada de 1 s, um `SendMessage` por
evento, em sequência e segurando as linhas travadas. Sob carga sustentada o lag do outbox cresce
para minutos. Nenhum evento se perde, mas os consumidores atrasam. Correção: `SendMessageBatch`
(10 por chamada), envio fora do lock das linhas já reservadas e publisher em instâncias
dedicadas.

### 5.8 O que ficou de fora e por quê

| Item | Motivo |
|---|---|
| Autenticação real (OIDC) | Permitido pelo enunciado; ponto de extensão pronto (seção 4). |
| Mesmo `messageId` com payload diferente | Tratado como duplicata (ack sem efeito); o hash fica gravado no inbox, mas não é comparado. Poderia ir para a DLQ como conflito. |
| `occurredAt` do provedor | Validado na mensagem, mas não gravado; o sistema usa o relógio do servidor. |
| Gauge de idade do outbox | O lag é medido no momento da publicação; um evento parado só aparece quando sai. Um gauge do pendente mais antigo exigiria uma consulta a mais por rodada. |
| `/metrics` autenticado | Aberto como o health; em produção ficaria atrás do ingress interno. |

### 5.9 Como as falhas foram testadas

Os testes rodam dentro do container `app`, sem acesso ao Docker. Por isso "Postgres fora" é
simulado bloqueando as conexões do banco descartável da instância (`ALLOW_CONNECTIONS false` +
`pg_terminate_backend`), e "SQS fora" e "morrer entre commit e ack" usam um proxy de teste
entre o app e o LocalStack, que trava o `DeleteMessage` ou responde 503. Para a instância, o
efeito é o mesmo de uma queda real; a diferença é que o teste controla o instante exato, o que
tornou esses cenários determinísticos.

---

## 6. Checklist eliminatória

Cada falha eliminatória do enunciado, com a evidência de que não ocorre. Os comandos rodam a
partir da raiz do repositório; os testes rodam como descrito no [README](README.md#testes).

| Falha eliminatória | Situação | Evidência no código | Teste que prova |
|---|---|---|---|
| `number` para dinheiro | não ocorre | `Money` sobre `decimal.js`; `NUMERIC(19,2)` no banco; string decimal no JSON. Lint proíbe `parseFloat`, `Number()` e `toFixed` em `src/`. `grep -rnE "parseFloat\|\.toFixed\(\|[^.a-zA-Z]Number\(" src` → 0 ocorrências; os 3 `Number.parseInt` de `src/` são de contagens (porta, limite de página, `receiveCount`), nunca de valor. | `test/lint/money-float-ban.test.ts`, `test/unit/domain/money/*.test.ts`, `test/integration/persistence/money-columns.test.ts` (`"0.10"`, `"1234567.89"` ida e volta) |
| saldo negativo causado por race | não ocorre | lock `FOR UPDATE` na carteira antes de qualquer decisão; débito sem saldo vira `REJECTED` antes de tocar o saldo; `CHECK (balance >= 0)` em `wallets` e `CHECK (balance_after >= 0)` no ledger | `test/concurrency/mandatory-scenario.test.ts` (2×80 em 100, repetido 20×, 3 instâncias), `test/concurrency/hot-wallet-mixed-load.test.ts` (HTTP + SQS na mesma carteira), `test/integration/persistence/constraints.test.ts` |
| débito ou crédito duplicado | não ocorre | `UNIQUE (idempotency_key)`, `UNIQUE (provider_id, external_transaction_id)`, `UNIQUE (wallet_id, transaction_id)` no ledger; inbox com PK `(consumer_name, message_id)` na mesma transação do efeito; índice único de reversão por referência | `test/concurrency/same-bet-50x.test.ts` (1 débito, 49 replays), `test/concurrency/killed-before-ack.test.ts` (`SIGKILL` entre commit e ack), `test/concurrency/concurrent-reversals.test.ts`, `test/concurrency/restart-consistency.test.ts` |
| idempotência apenas em memória | não ocorre | toda deduplicação é constraint do Postgres. Os `Map`/`Set` de `src/` (`grep -rnE "new (Map\|Set)" src`) são tabelas constantes de regra, o registro de métricas e o cache de URL de fila do SQS; nenhum guarda key, hash nem `messageId`. | `test/integration/application/idempotency-key-race.test.ts` (mesma key em 2 carteiras, processos concorrentes no Postgres), `test/integration/application/consume-wager-message.test.ts` (reentrega e entrega simultânea) |
| solução correta somente com uma instância | não ocorre | concorrência pela linha da carteira no Postgres; workers coordenados por `FOR UPDATE SKIP LOCKED`; sem estado compartilhado em memória nem eleição de líder | toda a suíte `test/concurrency/` sobe **3 processos reais** do app; `test/integration/messaging/two-publishers.test.ts` (2 processos no mesmo outbox) |
| publicação de evento antes do commit | não ocorre | o único ponto que grava evento é `SubmissionEvents` → `outbox.insert`, dentro da transação da submissão (`grep -rn "outbox.insert" src` → 1 ocorrência). Só o publisher envia ao SQS, e só lê linhas já commitadas. | `test/integration/persistence/mikro-orm-unit-of-work.test.ts` (erro desfaz carteira, ledger, transação, inbox e outbox juntos), `test/unit/application/submit-wager-transaction/events.test.ts` |
| ausência de ledger auditável | não ocorre | `wallet_ledger_entries` append-only (trigger barra `UPDATE`/`DELETE`), com `balance_before`, `balance_after`, direção e transação de origem; rejeições também ficam gravadas com `FailureCode`; extrato paginado e reconciliação que nunca corrige em silêncio | `test/integration/persistence/wallet-ledger-entries.migration.test.ts`, `test/integration/http/ledger.e2e.test.ts`, `test/integration/http/reconciliation.e2e.test.ts`, `assertLedgerInvariant` em todo teste de integração e concorrência |
| testes que substituem completamente PostgreSQL e SQS por mocks | não ocorre | testes de integração e concorrência usam Postgres e LocalStack reais, com banco e filas descartáveis por suíte. Nenhum deles importa repositório ou unidade de trabalho em memória; os únicos fakes ali são relógio, logger e métricas. Fakes completos ficam restritos a `test/unit/`. | `test/integration/**`, `test/concurrency/**`; para conferir: `grep -rlE "InMemory(UnitOfWork\|[A-Za-z]+Repository)" test/integration test/concurrency` → nenhum arquivo |

