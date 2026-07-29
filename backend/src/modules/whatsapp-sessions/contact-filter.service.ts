import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ContactFilterMode } from './dto/create-session.dto';
import type { ContactList } from './dto/add-contact-to-list.dto';

/**
 * 🔒 S24 — Lógica central de whitelist/blacklist por sessão.
 *
 * Regras (aplicadas em `shouldRespondTo` antes do `$transaction` no webhook):
 *
 *   whitelistMatch =
 *       (mode === 'whitelist' && contactInWhitelist)   // contato está na whitelist
 *    || (mode === 'whitelist' && whitelistIsEmpty)    // whitelist vazia = passa tudo
 *    || (mode !== 'whitelist');                       // whitelist desabilitada (mode=none|blacklist)
 *
 *   finalPass = whitelistMatch
 *             && !(mode === 'blacklist' && contactInBlacklist);
 *
 *   - 'none': passa (comportamento legado).
 *   - 'whitelist' + lista NÃO-vazia: só passa quem está na lista.
 *   - 'whitelist' + lista vazia: whitelist não restringe (cai pra blacklist).
 *   - 'blacklist' + lista NÃO-vazia: bloqueia quem está na lista.
 *   - contato na whitelist E blacklist ao mesmo tempo: prevalece o bloqueio
 *     (blacklist sempre vence — é uma trava de segurança).
 *
 * Performance: o `shouldRespondTo` faz UMA query (findMany em
 * session_contact_list_items filtrando por sessionId+contactId, agrupado
 * por list no app) — não precisa de 2 queries separadas. Em sessões
 * pequenas (lista de até poucos milhares) é instantâneo.
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

    // Sem settings ainda (legado) ou mode='none' → passa tudo.
    const mode: ContactFilterMode = (settings?.contactFilterMode as ContactFilterMode) ?? 'none';
    if (mode === 'none') return true;

    // Uma query traz AMBAS as listas em que o contato aparece nessa sessão.
    // 0 ou 1 linha por lista, no máximo 2 linhas.
    const items = await this.prisma.sessionContactListItem.findMany({
      where: { sessionId, contactId },
      select: { list: true },
    });
    const inWhitelist = items.some((i) => i.list === 'whitelist');
    const inBlacklist = items.some((i) => i.list === 'blacklist');

    // Tamanho das listas — para a regra "whitelist vazia = passa tudo".
    // Se o contato está na whitelist mas queremos saber se a lista está
    // vazia no geral, basta contar.
    const whitelistIsEmpty =
      mode === 'whitelist'
        ? !(await this.prisma.sessionContactListItem.findFirst({
            where: { sessionId, list: 'whitelist' },
            select: { id: true },
          }))
        : false;

    const whitelistPass =
      mode !== 'whitelist' /* whitelist desabilitada */
      || inWhitelist /* contato na lista */
      || whitelistIsEmpty; /* lista vazia = não restringe */

    const blacklistBlocks = mode === 'blacklist' && inBlacklist;

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
