import { describe, expect, test } from "bun:test";
import {
  ConnectionException,
  DeadlockException,
  DriverException,
  LockWaitTimeoutException,
  UniqueConstraintViolationException,
} from "@mikro-orm/postgresql";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { InvariantViolationError } from "../../../../src/domain/errors/invariant-violation.error";
import { ApiError } from "../../../../src/interfaces/http/errors/api-error";
import { toErrorReply } from "../../../../src/interfaces/http/errors/global-exception.filter";

function driverError(sqlState: string): DriverException {
  const error = new DriverException(new Error("driver failure"));
  error.sqlState = sqlState;
  return error;
}

describe("toErrorReply", () => {
  test("serializes an ApiError with its own status and code", () => {
    const reply = toErrorReply(ApiError.notFound("WALLET_NOT_FOUND", "wallet not found"));

    expect(reply).toEqual({
      status: 404,
      body: { code: "WALLET_NOT_FOUND", message: "wallet not found", retryable: false },
      headers: {},
    });
  });

  test("maps a Nest bad request (malformed JSON) to 400 INVALID_PAYLOAD", () => {
    const reply = toErrorReply(new BadRequestException("Unexpected token"));

    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({
      code: "INVALID_PAYLOAD",
      message: "INVALID_PAYLOAD",
      retryable: false,
    });
  });

  test("maps an unknown route to 404 NOT_FOUND", () => {
    expect(toErrorReply(new NotFoundException()).body.code).toBe("NOT_FOUND");
  });

  test.each([
    ["connection", new ConnectionException(new Error("ECONNREFUSED"))],
    ["deadlock", new DeadlockException(new Error("deadlock"))],
    ["lock timeout", new LockWaitTimeoutException(new Error("lock timeout"))],
    ["serialization", driverError("40001")],
    ["too many connections", driverError("53300")],
    ["admin shutdown", driverError("57P01")],
  ])("maps a transient %s failure to 503 retryable with Retry-After", (_name, error) => {
    const reply = toErrorReply(error);

    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({
      code: "TRANSIENT_FAILURE",
      message: "temporary failure, retry later",
      retryable: true,
    });
    expect(reply.headers).toEqual({ "Retry-After": "1" });
  });

  test.each([
    ["unique violation", new UniqueConstraintViolationException(new Error("duplicate key"))],
    ["domain bug", new InvariantViolationError("broken")],
    ["plain error", new Error("secret detail")],
  ])("maps a non-transient %s to 500 without leaking the message", (_name, error) => {
    const reply = toErrorReply(error);

    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({
      code: "INTERNAL_ERROR",
      message: "internal error",
      retryable: false,
    });
    expect(JSON.stringify(reply.body)).not.toContain("secret");
  });
});
