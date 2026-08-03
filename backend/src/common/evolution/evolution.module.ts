import { Global, Module } from '@nestjs/common';
import { EvolutionService } from './evolution.service';
import { EvolutionMessageParser } from './evolution-message-parser.service';

/**
 * 🔌 Evolution API — módulo de integração.
 *
 * A Evolution API é um serviço EXTERNO responsável exclusivamente pela
 * conexão e persistência das sessões do WhatsApp (em /evolution_data).
 * Este módulo expõe apenas o EvolutionService, uma camada fina sobre os
 * endpoints REST da Evolution API. Ele não conhece Prisma — quem persiste
 * estado no DB é o WhatsappSessionsService, que chama este serviço.
 *
 * É @Global() para que qq módulo (API e Worker) possa injetar
 * EvolutionService sem precisar importar EvolutionModule explicitamente.
 */
@Global()
@Module({
  providers: [EvolutionService, EvolutionMessageParser],
  exports: [EvolutionService, EvolutionMessageParser],
})
export class EvolutionModule {}
