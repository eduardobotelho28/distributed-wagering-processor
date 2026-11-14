import { describe, expect, test } from "bun:test";
import {
  ConfigValidationError,
  type Environment,
  loadConfig,
} from "../../../../src/infrastructure/config/app-config";

const validEnv: Environment = {
  DATABASE_URL: "postgres://user:secret@postgres:5432/wagering",
  AWS_REGION: "us-east-1",
  SQS_ENDPOINT: "http://localstack:4566",
  SQS_TRANSACTIONS_QUEUE: "wager-transactions.fifo",
  SQS_TRANSACTIONS_DLQ: "wager-transactions-dlq.fifo",
  SQS_EVENTS_QUEUE: "wager-events",
};

function problemsFor(env: Environment): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

describe("loadConfig", () => {
  test("loads required vars and applies defaults for tuning knobs", () => {
    const config = loadConfig(validEnv);

    expect(config.database.url).toBe("postgres://user:secret@postgres:5432/wagering");
    expect(config.sqs.transactionsQueue).toBe("wager-transactions.fifo");
    expect(config.port).toBe(3000);
    expect(config.workers.outboxPublishIntervalMs).toBe(1000);
    expect(config.limits.sqsMaxMessages).toBe(10);
  });

  test("reads explicit integer overrides", () => {
    const config = loadConfig({ ...validEnv, APP_PORT: "8080", OUTBOX_BATCH_SIZE: "200" });

    expect(config.port).toBe(8080);
    expect(config.limits.outboxBatchSize).toBe(200);
  });

  test.each(Object.keys(validEnv))("fails fast when %s is missing", (name) => {
    expect(problemsFor({ ...validEnv, [name]: undefined })).toEqual([`${name} is required`]);
  });

  test("treats a blank value as missing", () => {
    expect(problemsFor({ ...validEnv, AWS_REGION: "  " })).toEqual(["AWS_REGION is required"]);
  });

  test("reports every missing var at once", () => {
    expect(problemsFor({})).toHaveLength(Object.keys(validEnv).length);
  });

  test("rejects a malformed URL without echoing its value", () => {
    const problems = problemsFor({ ...validEnv, DATABASE_URL: "not a url secret" });

    expect(problems).toEqual(["DATABASE_URL must be a valid URL"]);
    expect(problems.join()).not.toContain("secret");
  });

  test.each(["0", "-1", "1.5", "1e3", "abc", "99999999999999999999"])(
    "rejects %p as a positive integer",
    (raw) => {
      expect(problemsFor({ ...validEnv, OUTBOX_BATCH_SIZE: raw })).toHaveLength(1);
    },
  );

  test("rejects values above the allowed maximum", () => {
    expect(problemsFor({ ...validEnv, SQS_MAX_MESSAGES: "11" })).toEqual([
      "SQS_MAX_MESSAGES must be an integer between 1 and 10",
    ]);
  });
});
