import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ContactListsService } from './contact-lists.service';
import { CreateContactListDto, AddContactsDto } from './dto';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';

@UseGuards(TenantGuard, RolesGuard)
@Roles('owner', 'admin')
@Controller('contact-lists')
export class ContactListsController {
  constructor(private readonly service: ContactListsService) {}

  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateContactListDto) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id);
  }

  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }

  @Post(':id/contacts')
  addContacts(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: AddContactsDto,
  ) {
    return this.service.addContacts(tenantId, id, dto);
  }

  @Delete(':id/contacts/:contactId')
  removeContact(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ) {
    return this.service.removeContact(tenantId, id, contactId);
  }
}
