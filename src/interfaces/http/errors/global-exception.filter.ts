import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import { isTransientDatabaseError } from "../../../infrastructure/persistence/transient-database-error";
import { PayloadValidationError } from "../../validation/payload-validation.error";
import { ApiError, type ErrorBody } from "./api-error";
import { HttpStatus, RETRY_AFTER_SECONDS } from "./http-status-table";

export interface ErrorReply {
  status: number;
  body: ErrorBody;
  headers: Record<string, string>;
}

interface HttpResponse {
  status(code: number): HttpResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

const CODES_BY_HTTP_STATUS: ReadonlyMap<number, string> = new Map([
  [HttpStatus.BAD_REQUEST, "INVALID_PAYLOAD"],
  [HttpStatus.NOT_FOUND, "NOT_FOUND"],
  [405, "METHOD_NOT_ALLOWED"],
  [413, "PAYLOAD_TOO_LARGE"],
  [415, "UNSUPPORTED_MEDIA_TYPE"],
]);

function fromHttpException(error: HttpException): ErrorReply {
  const status = error.getStatus();
  const code = CODES_BY_HTTP_STATUS.get(status) ?? "HTTP_ERROR";
  return { status, body: { code, message: code, retryable: false }, headers: {} };
}

// DECISION: a decisão vive numa função pura para ser testada sem subir o Nest.
// RISK: erro desconhecido vira 500 não-retryable com mensagem genérica; a causa real só
// aparece no log (T81), nunca no corpo, para não vazar detalhes internos.
export function toErrorReply(error: unknown): ErrorReply {
  if (error instanceof ApiError) return { status: error.status, body: error.toBody(), headers: {} };
  if (error instanceof PayloadValidationError) {
    return {
      status: HttpStatus.BAD_REQUEST,
      body: { code: error.code, message: error.message, retryable: false },
      headers: {},
    };
  }
  if (error instanceof HttpException) return fromHttpException(error);
  if (isTransientDatabaseError(error)) {
    return {
      status: HttpStatus.UNAVAILABLE,
      body: {
        code: "TRANSIENT_FAILURE",
        message: "temporary failure, retry later",
        retryable: true,
      },
      headers: { "Retry-After": String(RETRY_AFTER_SECONDS) },
    };
  }
  return {
    status: HttpStatus.INTERNAL,
    body: { code: "INTERNAL_ERROR", message: "internal error", retryable: false },
    headers: {},
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const reply = toErrorReply(error);
    const response = host.switchToHttp().getResponse<HttpResponse>();
    for (const [name, value] of Object.entries(reply.headers)) response.setHeader(name, value);
    response.status(reply.status).json(reply.body);
  }
}
