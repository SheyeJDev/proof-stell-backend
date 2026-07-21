import {
  IsUUID,
  IsNumber,
  IsArray,
  ValidateNested,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Min,
  Max,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InputEventType } from '../entities/input-event.entity';

export class InputEventDto {
  @IsEnum(InputEventType)
  eventType: InputEventType;

  @IsNumber()
  @Min(0)
  @Max(3_600_000) // Max 1 hour in ms
  timestamp: number;

  @IsObject()
  eventData: {
    x?: number;
    y?: number;
    key?: string;
    target?: string;
    accuracy?: number;
    [key: string]: any;
  };

  @IsOptional()
  @IsString()
  @MaxLength(64) // Cap clientId length to prevent oversized strings
  clientId?: string;
}

export class ReportSessionDto {
  @IsUUID()
  challengeId: string;

  @IsNumber()
  @Min(0)
  @Max(1_000_000) // Prevent absurd score spoofing
  score: number;

  @IsNumber()
  @Min(0)
  @Max(3_600_000) // Max 1 hour in ms
  duration: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InputEventDto)
  /**
   * Hard cap at 1000 input events per batch submission.
   * Prevents DoS via unbounded large arrays.
   * Was 10_000 — reduced as per security requirements.
   */
  @ArrayMaxSize(1000)
  inputs: InputEventDto[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsUUID()
  sessionId: string;

  @IsString()
  @MaxLength(128) // HMAC-SHA256 hex is 64 chars; 128 gives headroom while capping DoS
  signature: string;
}