import type {
  ProviderIdentity,
  ProviderIdentityPort,
} from "../../application/ports/provider-identity";

// RISK: autenticação não implementada (decisão documentada no ARCHITECTURE.md). Toda
// requisição recebe uma identidade sem restrição de provedor. Trocar esta classe por uma
// implementação OIDC é a única mudança necessária para ligar a autenticação.
export class TrustAllProviderIdentity implements ProviderIdentityPort {
  async resolve(): Promise<ProviderIdentity> {
    return { providerId: null };
  }
}
