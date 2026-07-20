import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * DTO for validating WebSocket game:subscribe payloads.
 * Enforces that gameId is a non-empty string with a capped length
 * to prevent DoS via oversized inputs.
 */
export class GameSubscribeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  gameId: string;
}