import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  normalizeContactFilterMode,
  type ContactFilterMode,
} from './dto/create-session.dto';
import type { ContactList } from './dto/add-contact-to-list.dto';

/**
 * 🔒 S24 — Lógica central de whitelist/blacklist por sessão.
 *
 * 🔒 S24-b — A semântica mudou. Antes havia três modos (`none`,
 * `whitelist`, `blacklist`); agora `blacklist` deixou de ser um modo
 * porque é na verdade um estilo de banimento, não um modo de filtro.
 *
 * Regras atuais (aplicadas em `shouldRespondTo` antes do `$transaction`
 * no webhook):
 *
 *   blacklistBlocks  = contactInBlacklist                 // SEMPRE bloqueia
 *
 *   whitelistPass    = mode !== 'whitelist'              // whitelist desabilitada
 *                    || contactInWhitelist               // contato na lista
 *                    || whitelistIsEmpty                 // whitelist vazia = passa tudo
 *
 *   finalPass        = whitelistPass && !blacklistBlocks
 *
 *   - mode='none' + lista NÃO-vazia: blacklist bloqueia quem está nela;
 *     quem não está passa (comportamento de banimento puro).
 *   - mode='whitelist' + lista NÃO-vazia: só passa quem está na whitelist
 *     E não está na blacklist.
 *   - mode='whitelist' + lista vazia: whitelist não restringe; cai pra
 *     só-blacklist (mesmo comportamento de mode='none').
 *   - contato na whitelist E blacklist ao mesmo tempo: prevalece o bloqueio
 *     (blacklist sempre vence — é uma trava de segurança).
 *
 * Performance: o `shouldRespondTo` faz DUAS queries no caso geral
 * (items por sessão+contato + count da whitelist para detectar lista
 * vazia). Em sessões pequenas (lista de até poucos milhares) é
 * instantâneo.
 */
@Injectable()
export class ContactFilterService {
  private readonly logger = new Logger(ContactFilterService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Decide se a sessão deve RESPONDER a uma mensagem inbound do `contactId`.
   * Retorna `true` se a mensagem pode prosseguir (persistir no DB e bot
   * responder). Retorna `false` se a mensagem deve ser DESCARTADA
   * (nem entra no DB, conforme decisão do usuário).
   *
   * @param sessionId sessão que recebeu a mensagem
   * @param contactId contato do remetente (já criado/upserted no DB)
   */
  async shouldRespondTo(sessionId: string, contactId: string): Promise<boolean> {
    const settings = await this.prisma.sessionSettings.findUnique({
      where: { sessionId },
      select: { contactFilterMode: true },
    });

    // 🔒 S24-b — Modos legados ('blacklist') são normalizados na leitura.
    const mode: ContactFilterMode = normalizeContactFilterMode(
      settings?.contactFilterMode,
    );

    // Uma query traz AMBAS as listas em que o contato aparece nessa sessão.
    // 0 ou 1 linha por lista, no máximo 2 linhas.
    const items = await this.prisma.sessionContactListItem.findMany({
      where: { sessionId, contactId },
      select: { list: true },
    });
    const inWhitelist = items.some((i) => i.list === 'whitelist');
    const inBlacklist = items.some((i) => i.list === 'blacklist');

    // Tamanho da whitelist — para a regra "whitelist vazia = passa tudo".
    // Só consulta quando o modo exige checar (mode='whitelist'); em
    // mode='none' a regra de whitelist é ignorada de qualquer forma.
    const whitelistIsEmpty =
      mode === 'whitelist'
        ? !(await this.prisma.sessionContactListItem.findFirst({
            where: { sessionId, list: 'whitelist' },
            select: { id: true },
          }))
        : false;

    // 🔒 S24-b — Blacklist é SEMPRE banimento, independente do modo.
    const blacklistBlocks = inBlacklist;

    const whitelistPass =
      mode !== 'whitelist' /* whitelist desabilitada */
      || inWhitelist /* contato na lista */
      || whitelistIsEmpty; /* lista vazia = não restringe */

    const passes = whitelistPass && !blacklistBlocks;
    if (!passes) {
      this.logger.log(
        `🚫 filtro rejeitou: session=${sessionId} contact=${contactId} ` +
          `mode=${mode} inWl=${inWhitelist} inBl=${inBlacklist} wlEmpty=${whitelistIsEmpty}`,
      );
    }
    return passes;
  }

  /**
   * Lista os contatos de uma lista (whitelist|blacklist) da sessão.
   * `take` e `cursor` opcionais pra paginação.
   */
  async listContacts(
    tenantId: string,
    sessionId: string,
    list: ContactList,
    opts: { take?: number; cursor?: string } = {},
  ) {
    const take = Math.min(Math.max(opts.take ?? 100, 1), 500);
    // Garante que a sessão é do tenant (defesa em profundidade)
    const session = await this.prisma.whatsappSession.findFirst({
      where: { id: sessionId, tenantId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');

    return this.prisma.sessionContactListItem.findMany({
      where: { sessionId, list },
      orderBy: { createdAt: 'desc' },
      take,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        list: true,
        note: true,
        createdAt: true,
        contact: {
          select: { id: true, phone: true, name: true, email: true, avatar: true },
        },
      },
    });
  }

  /**
   * Adiciona um contato a uma lista da sessão. Idempotente — se já
   * existir, atualiza só o `note` (caso venha) e devolve o existente.
   */
  async addContact(
    tenantId: string,
    sessionId: string,
    args: { contactId: string; list: ContactList; note?: string | null },
  ) {
    const session = await this.prisma.whatsappSession.findFirst({
      where: { id: sessionId, tenantId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');

    // O contato precisa ser do mesmo tenant (não vazamos dados cruzando tenants).
    const contact = await this.prisma.contact.findFirst({
      where: { id: args.contactId, tenantId },
      select: { id: true },
    });
    if (!contact) {
      throw new BadRequestException(
        'Contato não pertence a este tenant — crie o contato primeiro (POST /contacts)',
      );
    }

    return this.prisma.sessionContactListItem.upsert({
      where: {
        sessionId_contactId_list: {
          sessionId,
          contactId: args.contactId,
          list: args.list,
        },
      },
      update: {
        ...(args.note !== undefined ? { note: args.note } : {}),
      },
      create: {
        sessionId,
        contactId: args.contactId,
        list: args.list,
        note: args.note ?? null,
      },
      select: {
        id: true,
        list: true,
        note: true,
        createdAt: true,
        contactId: true,
      },
    });
  }

  /**
   * Remove um item da lista (não deleta o contato).
   */
  async removeContact(tenantId: string, sessionId: string, itemId: string) {
    const item = await this.prisma.sessionContactListItem.findFirst({
      where: { id: itemId, sessionId },
      select: { id: true, session: { select: { tenantId: true } } },
    });
    if (!item || item.session.tenantId !== tenantId) {
      throw new NotFoundException('Item não encontrado nesta sessão');
    }
    await this.prisma.sessionContactListItem.delete({ where: { id: itemId } });
    return { ok: true };
  }
}
