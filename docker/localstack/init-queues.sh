#!/bin/bash
set -euo pipefail

# DECISION: FIFO for wager transactions so messages for the same wallet
# (MessageGroupId) are delivered in order; the DLQ of a FIFO queue must also be FIFO.
# RISK: content-based dedup is off; producers must send MessageDeduplicationId.
# The DB (UNIQUE idempotency_key) stays the real dedup guarantee, not SQS.

DLQ_NAME="wager-transactions-dlq.fifo"
MAIN_NAME="wager-transactions.fifo"
EVENTS_NAME="wager-events"
MAX_RECEIVE_COUNT=5

awslocal sqs create-queue \
  --queue-name "$DLQ_NAME" \
  --attributes FifoQueue=true >/dev/null

DLQ_URL=$(awslocal sqs get-queue-url --queue-name "$DLQ_NAME" --query QueueUrl --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --query Attributes.QueueArn --output text)

awslocal sqs create-queue \
  --queue-name "$MAIN_NAME" \
  --attributes "{\"FifoQueue\":\"true\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"$MAX_RECEIVE_COUNT\\\"}\"}" >/dev/null

awslocal sqs create-queue --queue-name "$EVENTS_NAME" >/dev/null

echo "SQS queues ready: $MAIN_NAME, $DLQ_NAME, $EVENTS_NAME"
