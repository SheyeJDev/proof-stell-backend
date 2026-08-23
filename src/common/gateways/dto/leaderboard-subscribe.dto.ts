import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * DTO for validating WebSocket leaderboard:subscribe payloads.
 * Enforces that leaderboardId is a non-empty string with a capped length
 * to prevent DoS via oversized inputs.
 */
export class LeaderboardSubscribeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  leaderboardId: string;
}
