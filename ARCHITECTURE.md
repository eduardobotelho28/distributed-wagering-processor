# Arquitetura

> Rascunho. As seções de decisões, matriz de invariantes, códigos de falha e limitações
> entram nas tasks T96–T98.

## Autenticação

**Decisão: não implementada neste desafio**, como o README (§2) permite. Ela não vale pontos e
competiria em tempo com correção financeira, concorrência e idempotência. O ponto de extensão,
porém, está no código e ligado.

### O que existe no código

| Peça | Onde | Papel |
|---|---|---|
| `ProviderIdentityPort` | `src/application/ports/provider-identity.ts` | Resolve a identidade do provedor a partir das credenciais da requisição. `null` = não autenticado. |
| `TrustAllProviderIdentity` | `src/infrastructure/auth/trust-all-provider-identity.ts` | Implementação no-op: toda requisição recebe uma identidade sem restrição de provedor. |
| `AuthGuard` | `src/interfaces/http/auth/auth.guard.ts` | Guard **global** (`APP_GUARD`). Rota nova nasce protegida; só fica aberta com `@Public()`. Sem identidade, responde `401 UNAUTHENTICATED`. |
| `@Public()` | `src/interfaces/http/auth/public.decorator.ts` | Usado nos endpoints de health, que ficam abertos (README §2). |

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

## Limitações conhecidas

> Lista viva; consolidada na T98.

### Ordem do ledger depende do relógio da instância

O extrato (`GET /wallets/:id/ledger`) e o encadeamento verificado pelo checker de invariante
ordenam os lançamentos por `(created_at, id)`. O `created_at` vem do relógio de quem processou.

- **Dentro de uma instância** a ordem é correta: o lock pessimista da carteira serializa as
  movimentações e o relógio avança.
- **Com várias instâncias em máquinas com relógios dessincronizados**, dois lançamentos da mesma
  carteira podem receber `created_at` fora da ordem real em que o lock os serializou. O saldo e a
  soma do ledger continuam corretos (a reconciliação não acusa divergência), mas o extrato pode
  listar os lançamentos fora de ordem e o encadeamento `balance_before` → `balance_after`
  aparenta quebra.

**Mitigação adotada:** nenhuma no código; depende de NTP nas instâncias, o padrão em qualquer
ambiente gerenciado.

**Correção possível:** gravar em cada lançamento a versão da carteira (número de sequência por
carteira, já incrementado sob o lock em `Wallet.apply`) com `UNIQUE (wallet_id, wallet_version)`,
e ordenar extrato e cursor por essa coluna. Exige migration e mudança no cursor opaco.
