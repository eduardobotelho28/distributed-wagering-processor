import { HttpStatus, type HttpStatusCode } from "./http-status-table";

export interface ErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

// DECISION: controllers e pipes lançam ApiError com status e código estáveis; o filtro global
// só serializa. Mensagens são fixas por código e nunca ecoam o payload recebido.
export class ApiError extends Error {
  constructor(
    readonly status: HttpStatusCode,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static invalidPayload(code: string, message: string): ApiError {
    return new ApiError(HttpStatus.BAD_REQUEST, code, message);
  }

  static notFound(code: string, message: string): ApiError {
    return new ApiError(HttpStatus.NOT_FOUND, code, message);
  }

  toBody(): ErrorBody {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}
