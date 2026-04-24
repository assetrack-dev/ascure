import { IsUUID } from 'class-validator';

export class TemplateIdParamDto {
  @IsUUID()
  id!: string;
}

export class AssetTypeIdParamDto {
  @IsUUID()
  assetTypeId!: string;
}

export class TemplateSectionParamDto extends TemplateIdParamDto {
  @IsUUID()
  sectionId!: string;
}

export class TemplateItemParamDto extends TemplateIdParamDto {
  @IsUUID()
  itemId!: string;
}
