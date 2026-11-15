# Teste de carga

Experimento para medir vazão, latência e lag do outbox com várias instâncias reais, e para
verificar que a corretude financeira se mantém sob carga. **Não há meta de RPS**: o objetivo é
entender onde o sistema satura e por quê.

## Como reproduzir

Com a stack no ar (`docker compose up`):

```sh
docker compose exec app bun run test:load
```

O script (`test/load/run-load.ts`) cria um banco e uma fila de eventos descartáveis, sobe as
instâncias como processos separados, executa os cenários, confere o invariante do ledger em
todas as carteiras e imprime o relatório em Markdown. Parâmetros por variável de ambiente
(`docker compose exec -e NOME=valor app …`):

| Variável | Padrão | Significado |
|---|---|---|
| `LOAD_INSTANCES` | 3 | instâncias do app |
| `LOAD_CONCURRENCY` | 50 | usuários virtuais simultâneos |
| `LOAD_WALLETS` | 200 | carteiras do cenário espalhado |
| `LOAD_SPREAD_SECONDS` | 20 | duração do cenário espalhado |
| `LOAD_HOT_SECONDS` | 10 | duração do cenário de carteira concorrida |
| `LOAD_OUTBOX_INTERVAL_MS` | 1000 | intervalo do publisher (padrão do app) |
| `LOAD_OUTBOX_BATCH_SIZE` | 50 | lote do publisher (padrão do app) |

## Ambiente

- Notebook com Docker Desktop sobre WSL2 (kernel 6.6), **8 vCPUs e 3,7 GiB** visíveis no container.
- Bun 1.4.4, PostgreSQL 16.16 (`max_connections` 100), LocalStack 3.8 (SQS).
- O gerador de carga, as 3 instâncias, o Postgres e o LocalStack dividem **a mesma máquina**.
  Os números medem o sistema inteiro competindo por CPU, não uma instância isolada.
- Pool do MikroORM: padrão (10 conexões por instância, 30 no total).

## Metodologia

- **Modelo de carga:** laço fechado. Cada usuário virtual envia uma aposta (`POST
  /wagering/transactions`, BET de 1.00 com idempotency key nova), espera a resposta e envia a
  próxima. Mede a capacidade sob N clientes simultâneos, sem fila artificial no gerador.
- **Distribuição:** as requisições se revezam entre as 3 instâncias.
- **Cenário 1, carteiras espalhadas:** cada aposta vai para uma de 200 carteiras sorteada.
  Quase não há disputa de lock; mede a vazão do caminho de escrita.
- **Cenário 2, carteira concorrida:** todas as apostas na mesma carteira. Toda requisição
  disputa o mesmo lock; mede o custo da serialização.
- **Latência:** do envio até o fim da resposta, medida no gerador (`performance.now`).
- **Erro:** resposta 5xx ou falha de rede. Rejeição de negócio (422) seria contada à parte; as
  carteiras têm saldo de 1.000.000,00, então não há rejeição.
- **Conflitos de lock:** soma de `lock_conflicts_total` (deadlock, timeout de lock,
  serialização) no `/metrics` das instâncias, antes e depois de cada cenário.
- **Lag do outbox:** exato, calculado no banco depois que o outbox esvazia:
  `published_at - occurred_at` de cada evento gerado no cenário (cada aposta gera 2 eventos).
- **Corretude:** ao final, `assertLedgerInvariant` em todas as 201 carteiras (saldo == soma do
  ledger, lançamentos balanceados e encadeados).

## Resultados

### Execução A: configuração padrão (publisher a cada 1000 ms, lote 50)

| Cenário | Requisições | Req/s | p50 ms | p95 ms | p99 ms | Erros | Conflitos de lock | Lag do outbox p50 / p95 / p99 / máx ms |
|---|---|---|---|---|---|---|---|---|
| carteiras espalhadas | 5.687 | 282,8 | 159,8 | 371,9 | 463,6 | 0,00% | 0 | 54.142 / 106.946 / 110.694 / 111.105 |
| carteira concorrida | 1.050 | 99,3 | 470,6 | 805,8 | 986,2 | 0,00% | 0 | 5.871 / 9.471 / 9.884 / 9.987 |

### Execução B: repetição da configuração padrão

| Cenário | Requisições | Req/s | p50 ms | p95 ms | p99 ms | Erros | Conflitos de lock | Lag do outbox p50 / p95 / p99 / máx ms |
|---|---|---|---|---|---|---|---|---|
| carteiras espalhadas | 5.461 | 271,9 | 166,3 | 352,8 | 458,9 | 0,00% | 0 | 49.525 / 95.621 / 99.417 / 99.627 |
| carteira concorrida | 1.079 | 102,4 | 466,3 | 780,0 | 1.000,7 | 0,00% | 0 | 6.021 / 11.665 / 12.826 / 12.943 |

### Execução C: publisher ajustado (a cada 100 ms, lote 200)

| Cenário | Requisições | Req/s | p50 ms | p95 ms | p99 ms | Erros | Conflitos de lock | Lag do outbox p50 / p95 / p99 / máx ms |
|---|---|---|---|---|---|---|---|---|
| carteiras espalhadas | 3.513 | 172,3 | 238,6 | 618,2 | 726,4 | 0,00% | 0 | 23.046 / 30.378 / 31.055 / 31.304 |
| carteira concorrida | 858 | 81,7 | 576,7 | 938,7 | 1.261,3 | 0,00% | 0 | 131 / 359 / 462 / 518 |

Nas três execuções o invariante do ledger fechou em todas as 201 carteiras.

## Análise

1. **Corretude não degrada com carga.** Zero erros, zero conflitos de lock e invariante intacto
   em 17.648 apostas somadas nas três execuções. O lock pessimista faz as transações *esperarem* em fila; não há
   deadlock nem timeout, então nada é refeito.
2. **Os números são estáveis.** Entre A e B, a vazão variou ~4% e a latência p95 ~5%.
3. **A carteira concorrida custa ~2,8× em vazão** (283 → 99 req/s) e ~3× em latência (p50 160 →
   470 ms). É o comportamento esperado do desenho: todas as escritas de uma carteira passam pelo
   mesmo lock. Com 50 clientes na mesma carteira, cada requisição espera em média as outras na
   fila; a vazão por carteira fica perto de 100 movimentações/s nesta máquina. Para uma carteira
   de jogador isso sobra; para uma conta compartilhada (jackpot) não (ARCHITECTURE §5.1).
4. **O gargalo é o publisher do outbox, não a escrita.** Na configuração padrão, cada instância
   publica no máximo 50 eventos por segundo, com um `SendMessage` por evento, em sequência: ~100
   a 150 eventos/s no total. O cenário espalhado produz ~560 eventos/s (2 por aposta), então
   forma-se uma fila e o lag chega a 1–2 minutos. **Nenhum evento é perdido** (o outbox esvazia
   depois e todos são publicados), mas consumidores dos eventos ficam atrasados.
5. **Ajustar intervalo e lote não resolve sozinho.** Na execução C o lag da carteira concorrida
   caiu para ~0,4 s (a produção, ~160 eventos/s, ficou abaixo da capacidade de drenagem), mas o
   cenário espalhado ainda acumulou ~30 s de lag, e a vazão HTTP **caiu** ~40%. O publisher mais
   agressivo passa a competir por CPU, conexões e o próprio LocalStack com o caminho de escrita,
   tudo na mesma máquina.
6. **O que melhoraria de verdade:** usar `SendMessageBatch` (até 10 mensagens por chamada) e
   publicar sem segurar as linhas travadas durante o envio de cada mensagem; e, em produção,
   rodar o publisher em instâncias separadas da API. Ficou fora do escopo; está registrado em
   ARCHITECTURE §5.7.

## Limites do experimento

- Tudo numa máquina só: o gerador de carga e o LocalStack consomem a mesma CPU que o app e o
  Postgres. Os valores absolutos não representam um ambiente de produção; as **relações** entre
  cenários e o **ponto de saturação** (o publisher) são o resultado útil.
- O LocalStack não reproduz a latência nem os limites de taxa do SQS real.
- Só o caminho HTTP foi carregado. O consumidor SQS processa uma mensagem por vez por instância
  (ARCHITECTURE §5.6), então teria vazão menor que o HTTP por desenho.
- Duração curta (20 s + 10 s): mede o regime de pico, não efeitos de longo prazo como
  crescimento das tabelas e do índice (ARCHITECTURE §5.3).
