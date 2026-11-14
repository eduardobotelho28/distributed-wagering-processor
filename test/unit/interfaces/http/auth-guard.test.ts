import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import type {
  ProviderIdentity,
  ProviderIdentityPort,
  RequestCredentials,
} from "../../../../src/application/ports/provider-identity";
import { TrustAllProviderIdentity } from "../../../../src/infrastructure/auth/trust-all-provider-identity";
import { authorize } from "../../../../src/interfaces/http/auth/auth.guard";
import { IS_PUBLIC } from "../../../../src/interfaces/http/auth/public.decorator";
import { ApiError } from "../../../../src/interfaces/http/errors/api-error";
import { HealthController } from "../../../../src/interfaces/http/health/health.controller";

class RecordingIdentities implements ProviderIdentityPort {
  readonly calls: RequestCredentials[] = [];

  constructor(private readonly identity: ProviderIdentity | null) {}

  async resolve(credentials: RequestCredentials): Promise<ProviderIdentity | null> {
    this.calls.push(credentials);
    return this.identity;
  }
}

describe("authorize", () => {
  test("lets public routes through without resolving an identity", async () => {
    const identities = new RecordingIdentities(null);

    expect(await authorize(true, { authorization: null }, identities)).toBe(true);
    expect(identities.calls).toEqual([]);
  });

  test("rejects a protected route with 401 when no identity is resolved", async () => {
    const identities = new RecordingIdentities(null);

    const result = authorize(false, { authorization: "Bearer bad" }, identities);

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(identities.calls).toEqual([{ authorization: "Bearer bad" }]);
  });

  test("allows a protected route once an identity is resolved", async () => {
    const identities = new RecordingIdentities({ providerId: "provider-a" });

    expect(await authorize(false, { authorization: "Bearer ok" }, identities)).toBe(true);
  });

  test("the no-op identity accepts every request", async () => {
    expect(await authorize(false, { authorization: null }, new TrustAllProviderIdentity())).toBe(
      true,
    );
  });
});

describe("public routes", () => {
  test("health is marked public", () => {
    expect(Reflect.getMetadata(IS_PUBLIC, HealthController)).toBe(true);
  });
});
