#!/bin/bash
set -euo pipefail

# FIFO para wager transactions para que mensagens para a mesma wallet (MessageGroupId) sejam entregues na ordem; a DLQ de uma fila FIFO também deve ser FIFO.
# Ponto de Atenação: deduplicação baseada em conteúdo está desativada; os produtores devem enviar MessageDeduplicationId. Logo, a DB (UNIQUE idempotency_key) continua sendo a verdadeira garantia de deduplicação, não o SQS.

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
