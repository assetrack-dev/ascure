import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, IsUUID, ValidateNested } from 'class-validator';

export class DefectMaterialLineDto {
  @IsUUID()
  materialId!: string;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  quantity!: number;
}

/** The full materials list of one Kejanggalan (replaces what was there). */
export class SetDefectMaterialsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DefectMaterialLineDto)
  items!: DefectMaterialLineDto[];
}
