import { describe, expect, test } from "bun:test";
import { ConnectionException } from "@mikro-orm/postgresql";
import {
  classifyResult,
  retryDelaySeconds,
} from "../../../../src/interfaces/sqs/wager-message.consumer";
import { FailureCode } from "../../../../src/domain/errors/failure-code";
import { TransactionStatus } from "../../../../src/domain/transaction/transaction-status";
import { createConsumerFixture, DLQ, QUEUE } from "../../../support/consumer-fixture";

describe("consumer classification: business outcomes are acked after commit", () => {
  test.each([
    ["processed BET", { kind: "BET" }],
    [
      "rejected BET (insufficient funds)",
      { kind: "BET", money: { amount: "999.00", currency: "BRL" } },
    ],
    ["pending refund", { kind: "REFUND", referenceExternalTransactionId: "never-sent" }],
  ])("%s -> ack", async (_name, data) => {
    const fixture = await createConsumerFixture("100.00");
    const message = fixture.message(data);

    const disposition = await fixture.consumer.handle(message);

    expect(disposition).toEqual({ kind: "ack" });
    expect(fixture.queue.calls).toEqual([
      { action: "ack", queue: QUEUE, receiptHandle: message.receiptHandle },
    ]);
  });

  test("a redelivered message is acked again without a second effect", async () => {
    const fixture = await createConsumerFixture("100.00");
    const message = fixture.message();
    await fixture.consumer.handle(message);
    const entries = fixture.submit.unitOfWork.repositories.ledger.entries.length;

    const disposition = await fixture.consumer.handle({ ...message, receiveCount: 2 });

    expect(disposition).toEqual({ kind: "ack" });
    expect(fixture.submit.unitOfWork.repositories.ledger.entries).toHaveLength(entries);
    expect(fixture.submit.wallet.balance.toJSON().amount).toBe("90.00");
  });

  test("ack happens only after the use case committed", async () => {
    const fixture = await createConsumerFixture("100.00");
    const order: string[] = [];
    const inbox = fixture.submit.unitOfWork.repositories.inbox;
    const markProcessed = inbox.markProcessed.bind(inbox);
    inbox.markProcessed = async (message) => {
      order.push("committed");
      return markProcessed(message);
    };
    const ack = fixture.queue.ack.bind(fixture.queue);
    fixture.queue.ack = async (queue, receipt) => {
      order.push("ack");
      return ack(queue, receipt);
    };

    await fixture.consumer.handle(fixture.message());

    expect(order).toEqual(["committed", "ack"]);
  });
});

describe("consumer classification: transient failures retry with backoff", () => {
  test("a database outage leaves the message unacked and delays it", async () => {
    const fixture = await createConsumerFixture("100.00");
    fixture.submit.unitOfWork.repositories.wallets.findByIdForUpdate = async () => {
      throw new ConnectionException(new Error("ECONNREFUSED"));
    };
    const message = fixture.message({}, 3);

    const disposition = await fixture.consumer.handle(message);

    expect(disposition.kind).toBe("retry");
    expect(fixture.queue.calls).toEqual([
      {
        action: "changeVisibility",
        queue: QUEUE,
        receiptHandle: message.receiptHandle,
        timeoutSeconds: 20,
      },
    ]);
  });

  test("backoff doubles from 5s and caps at 5 minutes", () => {
    expect([1, 2, 3, 4, 7, 20].map(retryDelaySeconds)).toEqual([5, 10, 20, 40, 300, 300]);
  });
});

describe("consumer classification: permanent failures go to the DLQ path", () => {
  test.each([["malformed JSON", "{oops", "INVALID_JSON"]])(
    "%s -> sent to the DLQ with its reason, then acked",
    async (_name, body, code) => {
      const fixture = await createConsumerFixture();
      const message = { ...fixture.message(), body };

      const disposition = await fixture.consumer.handle(message);

      expect(disposition).toMatchObject({ kind: "deadLetter", code });
      expect(fixture.queue.calls.map((call) => `${call.action}:${call.queue}`)).toEqual([
        `send:${DLQ}`,
        `ack:${QUEUE}`,
      ]);
      const sent = fixture.queue.calls[0]?.message;
      expect(JSON.parse(sent?.body ?? "{}")).toMatchObject({
        code,
        messageId: null,
        originalBody: body,
        receiveCount: 1,
      });
      expect(sent?.deduplicationId).toBe(message.transportId);
    },
  );

  test.each([
    ["OPENING", { kind: "OPENING" }, "OPENING_NOT_ALLOWED"],
    ["float money", { money: { amount: 1.5, currency: "BRL" } }, "INVALID_MONEY"],
    ["zero BET", { money: { amount: "0.00", currency: "BRL" } }, "AMOUNT_NOT_POSITIVE"],
  ])("%s -> deadLetter", async (_name, data, code) => {
    const fixture = await createConsumerFixture();

    expect(await fixture.consumer.handle(fixture.message(data))).toMatchObject({
      kind: "deadLetter",
      code,
    });
  });

  test("an idempotency conflict is permanent", () => {
    expect(
      classifyResult({
        outcome: "handled",
        result: { outcome: "idempotencyConflict", transactionId: "tx", idempotentReplay: false },
      }),
    ).toMatchObject({ kind: "deadLetter", code: "IDEMPOTENCY_CONFLICT" });
  });

  test("a messageId reused with another payload is permanent", () => {
    expect(classifyResult({ outcome: "messageConflict" })).toMatchObject({
      kind: "deadLetter",
      code: "MESSAGE_ID_CONFLICT",
    });
  });

  test("an external transaction id conflict is permanent", () => {
    expect(
      classifyResult({
        outcome: "handled",
        result: { outcome: "externalIdConflict", transactionId: "tx", idempotentReplay: false },
      }),
    ).toMatchObject({ kind: "deadLetter", code: "EXTERNAL_TRANSACTION_ID_CONFLICT" });
  });
});

describe("consumer retry limit", () => {
  test("at the limit, records FAILED, dead-letters with the reason and acks", async () => {
    const fixture = await createConsumerFixture("100.00");
    // O fake não faz rollback; a falha acontece já no insert do inbox (uma vez), como se a
    // transação inteira tivesse sido desfeita. O caminho real é coberto contra Postgres.
    const inbox = fixture.submit.unitOfWork.repositories.inbox;
    const tryInsert = inbox.tryInsert.bind(inbox);
    let failures = 1;
    inbox.tryInsert = async (message) => {
      if (failures-- > 0) throw new ConnectionException(new Error("ECONNREFUSED"));
      return tryInsert(message);
    };
    const message = fixture.message({}, 5);

    const disposition = await fixture.consumer.handle(message);

    expect(disposition).toMatchObject({ kind: "deadLetter", code: "RETRIES_EXHAUSTED" });
    const stored = [...fixture.submit.unitOfWork.repositories.transactions.rows.values()].at(-1);
    expect(stored?.transaction.status).toBe(TransactionStatus.FAILED);
    expect(stored?.transaction.failureCode).toBe(FailureCode.INTERNAL_PERMANENT_ERROR);
    expect(fixture.queue.calls.map((call) => `${call.action}:${call.queue}`)).toEqual([
      `send:${DLQ}`,
      `ack:${QUEUE}`,
    ]);
    expect(JSON.parse(fixture.queue.calls[0]?.message?.body ?? "{}")).toMatchObject({
      code: "RETRIES_EXHAUSTED",
      receiveCount: 5,
    });
    expect(fixture.queue.calls[0]?.message?.groupId).toBe(fixture.submit.wallet.id);
  });

  test("below the limit it only delays the message", async () => {
    const fixture = await createConsumerFixture("100.00");
    fixture.submit.unitOfWork.repositories.wallets.findByIdForUpdate = async () => {
      throw new ConnectionException(new Error("ECONNREFUSED"));
    };

    const disposition = await fixture.consumer.handle(fixture.message({}, 4));

    expect(disposition.kind).toBe("retry");
    expect(fixture.queue.calls.map((call) => call.action)).toEqual(["changeVisibility"]);
  });

  test("still dead-letters when FAILED cannot be recorded, and logs it", async () => {
    const fixture = await createConsumerFixture("100.00");
    const repositories = fixture.submit.unitOfWork.repositories;
    repositories.wallets.findByIdForUpdate = async () => {
      throw new ConnectionException(new Error("ECONNREFUSED"));
    };
    repositories.inbox.tryInsert = async () => {
      throw new ConnectionException(new Error("ECONNREFUSED"));
    };

    const disposition = await fixture.consumer.handle(fixture.message({}, 5));

    expect(disposition).toMatchObject({ kind: "deadLetter", code: "RETRIES_EXHAUSTED" });
    expect(fixture.logger.errors.map((entry) => entry.message)).toEqual([
      "could not record abandoned wager message",
      "wager message moved to dead-letter queue",
    ]);
  });
});
