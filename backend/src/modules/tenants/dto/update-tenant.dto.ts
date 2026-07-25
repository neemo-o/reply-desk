import { IsOptional, IsString, MinLength, MaxLength, Matches } from 'class-validator';

/**
 * 🔒 Edição básica do tenant — owner only.
 * Campos opcionais: apenas o que for enviado será atualizado.
 */
export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug deve conter apenas letras minúsculas, números e hífens',
  })
  @MinLength(2)
  @MaxLength(60)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  logo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;
}
