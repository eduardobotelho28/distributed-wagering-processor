import { SQSClient } from "@aws-sdk/client-sqs";
import type { AppConfig } from "../config/app-config";

// DECISION: credenciais pela cadeia padrão do SDK (variáveis AWS_ACCESS_KEY_ID/SECRET no
// LocalStack, role da instância na AWS); nada de chave no código ou na config da aplicação.
export function createSqsClient(config: AppConfig["sqs"]): SQSClient {
  return new SQSClient({ region: config.region, endpoint: config.endpoint });
}
