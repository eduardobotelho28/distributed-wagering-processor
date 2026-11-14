import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import type { IdGenerator } from "../../../application/ports/id-generator";
import type { Logger } from "../../../application/ports/logger";
import { runWithLogContext } from "../../../infrastructure/observability/log-context";
import { ID_GENERATOR, LOGGER } from "../../tokens";
import { toErrorReply } from "../errors/global-exception.filter";
import { readCorrelationId } from "../validation/path-and-query";

const CORRELATION_HEADER = "x-correlation-id";

interface HttpRequest {
  method: string;
  route?: { path?: string };
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

interface HttpResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
}

// DECISION: o correlationId nasce aqui (header válido ou gerado), é gravado de volta no header
// da requisição para o controller usar o MESMO valor, e é devolvido na resposta. Todo o
// handler roda dentro do contexto de log, então qualquer log da requisição o carrega.
// DECISION: o log de acesso usa o padrão da rota (/wallets/:walletId), nunca a URL com ids
// nem a query string.
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();
    const correlationId = readCorrelationId(request.headers[CORRELATION_HEADER], () =>
      this.ids.next(),
    );
    request.headers[CORRELATION_HEADER] = correlationId;
    response.setHeader(CORRELATION_HEADER, correlationId);
    const startedAt = performance.now();
    const access = (statusCode: number) =>
      this.logger.info("http request", {
        method: request.method,
        route: request.route?.path ?? "unmatched",
        statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    return new Observable((subscriber) =>
      runWithLogContext({ correlationId }, () =>
        next
          .handle()
          .pipe(
            tap({
              next: () => access(response.statusCode),
              error: (error: unknown) => access(toErrorReply(error).status),
            }),
          )
          .subscribe(subscriber),
      ),
    );
  }
}
