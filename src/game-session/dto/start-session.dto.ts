import { IsUUID } from 'class-validator';

/**
 * Data transfer object for starting a new game session.
 *
 * This DTO validates game session start requests, ensuring the challenge ID
 * is a valid UUID format for session tracking and integrity verification.
 */
export class StartSessionDto {
  /**
   * The unique identifier of the challenge to start a session for.
   * Must be a valid UUID v4 format.
   *
   * @example "550e8400-e29b-41d4-a716-446655440000"
   */
  @IsUUID()
  challengeId: string;
}
