import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isUuid } from '../../common/utils/security';
import { CreateContactListDto, AddContactsDto } from './dto';

@Injectable()
export class ContactListsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateContactListDto) {
    return this.prisma.contactList.create({ data: { tenantId, name: dto.name } });
  }

  findAll(tenantId: string) {
    return this.prisma.contactList.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
  }

  async findOne(tenantId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException('Lista não encontrada');
    const list = await this.prisma.contactList.findFirst({
      where: { id, tenantId },
      include: {
        items: { include: { contact: { select: { id: true, name: true, phone: true } } } },
        _count: { select: { items: true } },
      },
    });
    if (!list) throw new NotFoundException('Lista não encontrada');
    return list;
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.prisma.contactList.delete({ where: { id } });
    return { success: true };
  }

  async addContacts(tenantId: string, listId: string, dto: AddContactsDto) {
    const list = await this.findOne(tenantId, listId);
    // valida que todos os contactIds pertencem ao tenant.
    const existing = await this.prisma.contact.findMany({
      where: { id: { in: dto.contactIds }, tenantId },
      select: { id: true },
    });
    const validIds = new Set(existing.map((c) => c.id));
    const toInsert = dto.contactIds.filter((id) => validIds.has(id));
    if (toInsert.length === 0) return { added: 0 };
    const result = await this.prisma.contactListItem.createMany({
      data: toInsert.map((contactId) => ({ contactListId: list.id, contactId })),
      skipDuplicates: true,
    });
    return { added: result.count };
  }

  async removeContact(tenantId: string, listId: string, contactId: string) {
    const list = await this.findOne(tenantId, listId);
    await this.prisma.contactListItem.deleteMany({
      where: { contactListId: list.id, contactId },
    });
    return { success: true };
  }
}
