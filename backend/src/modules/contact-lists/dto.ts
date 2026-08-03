import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateContactListDto {
  @IsString()
  @MaxLength(120)
  name: string;
}

export class AddContactsDto {
  @IsString({ each: true })
  contactIds: string[];
}
