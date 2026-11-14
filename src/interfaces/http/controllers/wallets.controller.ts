import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import type { CreateWalletUseCase } from "../../../application/create-wallet/create-wallet.use-case";
import type { GetLedgerUseCase } from "../../../application/queries/get-ledger.use-case";
import type { GetWalletUseCase } from "../../../application/queries/get-wallet.use-case";
import type { ReconcileWalletUseCase } from "../../../application/reconcile-wallet/reconcile-wallet.use-case";
import { ApiError } from "../errors/api-error";
import { HttpStatus } from "../errors/http-status-table";
import {
  type LedgerEntryBody,
  ledgerEntryToBody,
  type ReconciliationBody,
  reconciliationToBody,
  type WalletBody,
  walletToBody,
} from "../mappers/resource.mapper";
import * as tokens from "../../tokens";
import { parseCreateWalletRequest } from "../validation/create-wallet.request";
import { readCursor, readLimit, readPathUuid } from "../validation/path-and-query";

function walletNotFound(): ApiError {
  return ApiError.notFound("WALLET_NOT_FOUND", "wallet not found");
}

@Controller("wallets")
export class WalletsController {
  constructor(
    @Inject(tokens.CREATE_WALLET) private readonly createWallet: CreateWalletUseCase,
    @Inject(tokens.GET_WALLET) private readonly getWallet: GetWalletUseCase,
    @Inject(tokens.GET_LEDGER) private readonly getLedger: GetLedgerUseCase,
    @Inject(tokens.RECONCILE_WALLET) private readonly reconcileWallet: ReconcileWalletUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown): Promise<WalletBody> {
    const result = await this.createWallet.execute(parseCreateWalletRequest(body));
    if (result.outcome === "conflict") {
      throw new ApiError(
        HttpStatus.CONFLICT,
        "WALLET_ALREADY_EXISTS",
        "a wallet already exists for this player and currency",
      );
    }
    return walletToBody(result.wallet);
  }

  @Get(":walletId")
  async findOne(@Param("walletId") walletId: unknown): Promise<WalletBody> {
    const result = await this.getWallet.execute(readPathUuid(walletId, "walletId"));
    if (result.outcome === "notFound") throw walletNotFound();
    return walletToBody(result.wallet);
  }

  @Get(":walletId/ledger")
  async ledger(
    @Param("walletId") walletId: unknown,
    @Query("cursor") cursor: unknown,
    @Query("limit") limit: unknown,
  ): Promise<{ entries: LedgerEntryBody[]; nextCursor: string | null }> {
    const result = await this.getLedger.execute({
      walletId: readPathUuid(walletId, "walletId"),
      cursor: readCursor(cursor),
      limit: readLimit(limit),
    });
    switch (result.outcome) {
      case "walletNotFound":
        throw walletNotFound();
      case "invalidCursor":
        throw ApiError.invalidPayload("INVALID_CURSOR", "cursor is invalid or expired");
      case "invalidLimit":
        throw ApiError.invalidPayload("INVALID_LIMIT", `limit must be between 1 and ${result.max}`);
      case "found":
        return { entries: result.entries.map(ledgerEntryToBody), nextCursor: result.nextCursor };
    }
  }

  // DECISION: 200 mesmo com divergência; a reconciliação em si deu certo e o resultado
  // (consistent: false) está no corpo. Um erro HTTP esconderia o relatório.
  @Post(":walletId/reconciliation")
  @HttpCode(HttpStatus.OK)
  async reconcile(@Param("walletId") walletId: unknown): Promise<ReconciliationBody> {
    const result = await this.reconcileWallet.execute(readPathUuid(walletId, "walletId"));
    if (result.outcome === "walletNotFound") throw walletNotFound();
    return reconciliationToBody(result.report);
  }
}
