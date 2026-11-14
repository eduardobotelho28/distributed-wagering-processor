export interface ProviderIdentity {
  // null = identidade não restrita a um provedor (implementação no-op, sem IdP).
  providerId: string | null;
}

export interface RequestCredentials {
  authorization: string | null;
}

// DECISION: ponto de extensão da autenticação (README §2). Hoje a implementação é no-op;
// com um IdP (Keycloak/OIDC), a implementação valida o JWT e devolve o providerId do claim.
// INVARIANT: null significa "não autenticado" e vira 401; nunca "liberado".
export interface ProviderIdentityPort {
  resolve(credentials: RequestCredentials): Promise<ProviderIdentity | null>;
}
