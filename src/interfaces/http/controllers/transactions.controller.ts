import { Body, Controller, Get, Headers, Inject, Param, Post, Res } from "@nestjs/common";
import type { IdGenerator } from "../../../application/ports/id-generator";
import type { GetTransactionResult } from "../../../application/queries/get-transaction-by-id.use-case";
import type { GetTransactionByIdUseCase } from "../../../application/queries/get-transaction-by-id.use-case";
import type { GetTransactionByProviderExternalIdUseCase } from "../../../application/queries/get-transaction-by-provider-external-id.use-case";
import type { SubmitWagerTransactionUseCase } from "../../../application/submit-wager-transaction/submit-wager-transaction.use-case";
import { ApiError } from "../errors/api-error";
import { type TransactionBody, transactionToBody } from "../mappers/resource.mapper";
import {
  type RejectedReplyBody,
  submitResultToHttp,
  type TransactionReplyBody,
} from "../mappers/submit-result.mapper";
import * as tokens from "../tokens";
import { readCorrelationId, readPathUuid } from "../validation/path-and-query";
import { readText } from "../../validation/field-readers";
import { parseSubmitTransactionRequest } from "../validation/submit-transaction.request";

interface StatusResponse {
  status(code: number): unknown;
}

function foundOrThrow(result: GetTransactionResult): TransactionBody {
  if (result.outcome === "notFound") {
    throw ApiError.notFound("TRANSACTION_NOT_FOUND", "transaction not found");
  }
  return transactionToBody(result.transaction);
}

@Controller()
export class TransactionsController {
  constructor(
    @Inject(tokens.SUBMIT_TRANSACTION) private readonly submit: SubmitWagerTransactionUseCase,
    @Inject(tokens.GET_TRANSACTION_BY_ID) private readonly getById: GetTransactionByIdUseCase,
    @Inject(tokens.GET_TRANSACTION_BY_EXTERNAL_ID)
    private readonly getByExternalId: GetTransactionByProviderExternalIdUseCase,
    @Inject(tokens.ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  // DECISION: o status vem do resultado (201/200/202/422/500), então é definido via `Res`
  // em modo passthrough; o corpo continua sendo serializado pelo Nest.
  @Post("wagering/transactions")
  async create(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: unknown,
    @Headers("x-correlation-id") correlationId: unknown,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<TransactionReplyBody | RejectedReplyBody> {
    const request = parseSubmitTransactionRequest(body, idempotencyKey);
    const result = await this.submit.execute({
      ...request,
      context: {
        correlationId: readCorrelationId(correlationId, () => this.ids.next()),
        causationId: null,
      },
    });
    const reply = submitResultToHttp(result);
    response.status(reply.status);
    return reply.body;
  }

  @Get("wagering/transactions/:transactionId")
  async findById(@Param("transactionId") transactionId: unknown): Promise<TransactionBody> {
    return foundOrThrow(await this.getById.execute(readPathUuid(transactionId, "transactionId")));
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  async findByExternalId(
    @Param("providerId") providerId: unknown,
    @Param("externalTransactionId") externalTransactionId: unknown,
  ): Promise<TransactionBody> {
    const params = { providerId, externalTransactionId };
    const result = await this.getByExternalId.execute({
      providerId: readText(params, "providerId"),
      externalTransactionId: readText(params, "externalTransactionId"),
    });
    return foundOrThrow(result);
  }
}
