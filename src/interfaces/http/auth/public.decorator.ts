import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "auth:isPublic";

// Marca rotas que dispensam autenticação (health, README §2).
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
