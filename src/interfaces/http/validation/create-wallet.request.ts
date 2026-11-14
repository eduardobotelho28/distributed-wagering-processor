import type { CreateWalletInput } from "../../../application/create-wallet/create-wallet.use-case";
import { readMoney, readText, requireObject } from "../../validation/field-readers";

export function parseCreateWalletRequest(body: unknown): CreateWalletInput {
  const source = requireObject(body, "body");
  return {
    playerId: readText(source, "playerId"),
    initialBalance: readMoney(source, "initialBalance"),
  };
}
