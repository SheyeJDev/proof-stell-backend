import { IsUUID, IsInt, Min } from 'class-validator';

/**
 * Data transfer object for submitting a score to the leaderboard.
 * 
 * This DTO validates score submission requests, ensuring the user ID
 * is a valid UUID and the score is a non-negative integer.
 */
export class SubmitScoreDto {
  /**
   * The unique identifier of the user submitting the score.
   * Must be a valid UUID v4 format.
   * 
   * @example "550e8400-e29b-41d4-a716-446655440000"
   */
  @IsUUID()
  userId: string;

  /**
   * The score to submit to the leaderboard.
   * Must be a non-negative integer.
   * 
   * @example 1500
   */
  @IsInt()
  @Min(0)
  score: number;
}
