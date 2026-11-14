import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type {
  ProviderIdentityPort,
  RequestCredentials,
} from "../../../application/ports/provider-identity";
import { ApiError } from "../errors/api-error";
import { HttpStatus } from "../errors/http-status-table";
import { PROVIDER_IDENTITY } from "../../tokens";
import { IS_PUBLIC } from "./public.decorator";

interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

function credentialsOf(request: RequestWithHeaders): RequestCredentials {
  const header = request.headers.authorization;
  return { authorization: typeof header === "string" ? header : null };
}

// DECISION: a decisão vive numa função pura; o guard só extrai metadata e headers do Nest.
export async function authorize(
  isPublic: boolean,
  credentials: RequestCredentials,
  identities: ProviderIdentityPort,
): Promise<true> {
  if (isPublic) return true;
  const identity = await identities.resolve(credentials);
  if (identity === null) {
    throw new ApiError(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "authentication required");
  }
  return true;
}

// DECISION: guard global (APP_GUARD) em vez de por controller; uma rota nova nasce protegida
// e só fica aberta se for marcada com @Public explicitamente.
// RISK: a checagem "providerId do token == providerId do payload" ainda não existe porque a
// identidade no-op não restringe provedor; com um IdP real, entra no controller de transações.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PROVIDER_IDENTITY) private readonly identities: ProviderIdentityPort,
  ) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic =
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    return authorize(isPublic, credentialsOf(request), this.identities);
  }
}
