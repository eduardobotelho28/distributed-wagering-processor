import { loadConfig } from "../config/app-config";
import { buildMikroOrmOptions } from "./mikro-orm.config";

// DECISION: o CLI reutiliza a mesma validação de env do boot, então migrations nunca rodam contra uma DATABASE_URL diferente da app.
export default buildMikroOrmOptions(loadConfig(process.env).database.url);
