import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';

interface SessionData {
  duration: number;
  inputs?: Array<{ timestamp: number; sequence?: number; clientId?: string }>;
  sessionId?: string;
  signature?: string;
}

interface ValidationResult {
  isValid: boolean;
  reason?: string;
}

interface ReplayDetectionResult {
  isSuspicious: boolean;
  reason?: string;
  details?: Record<string, any>;
}

@Injectable()
export class SessionIntegrityService {
  private readonly logger = new Logger(SessionIntegrityService.name);
  private readonly MAX_INPUTS_PER_SECOND = 50;
  private readonly MAX_INPUTS_PER_100MS = 10;
  private readonly TIMING_TOLERANCE_PERCENT = 0.05; // 5% tolerance
  private readonly MIN_DURATION_MS = 100; // Minimum session duration
  private readonly MAX_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours max

  constructor(private readonly cacheService: CacheService) {}

  validateSessionTiming(
    sessionData: SessionData,
    userId?: string,
  ): ValidationResult {
    const { duration, inputs } = sessionData;

    // Validate duration bounds
    if (duration < this.MIN_DURATION_MS) {
      return {
        isValid: false,
        reason: `Duration ${duration}ms is below minimum ${this.MIN_DURATION_MS}ms`,
      };
    }

    if (duration > this.MAX_DURATION_MS) {
      return {
        isValid: false,
        reason: `Duration ${duration}ms exceeds maximum ${this.MAX_DURATION_MS}ms`,
      };
    }

    // If no inputs, timing cannot be validated but is acceptable
    if (!inputs || inputs.length === 0) {
      return { isValid: true };
    }

    // Validate all timestamps are present and valid
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      if (input.timestamp === undefined || input.timestamp === null) {
        return {
          isValid: false,
          reason: `Input at index ${i} has missing timestamp`,
        };
      }

      if (typeof input.timestamp !== 'number' || isNaN(input.timestamp)) {
        return {
          isValid: false,
          reason: `Input at index ${i} has invalid timestamp type`,
        };
      }

      if (input.timestamp < 0) {
        return {
          isValid: false,
          reason: `Input at index ${i} has negative timestamp`,
        };
      }
    }

    // Calculate actual duration from timestamps
    const timestamps = inputs.map((i) => i.timestamp);
    const firstInput = Math.min(...timestamps);
    const lastInput = Math.max(...timestamps);
    const actualDuration = lastInput - firstInput;

    // Validate that actual duration matches reported duration
    const tolerance = duration * this.TIMING_TOLERANCE_PERCENT;
    const difference = Math.abs(duration - actualDuration);

    if (difference > tolerance) {
      return {
        isValid: false,
        reason: `Reported duration ${duration}ms differs from calculated ${actualDuration}ms by ${difference}ms (exceeds tolerance ${tolerance}ms)`,
      };
    }

    // Check for timestamp anomalies (future timestamps)
    const now = Date.now();
    const futureTimestamps = timestamps.filter((t) => t > now);
    if (futureTimestamps.length > 0) {
      return {
        isValid: false,
        reason: `${futureTimestamps.length} inputs have future timestamps`,
      };
    }

    // Check for timestamp anomalies (very old timestamps)
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const oldTimestamps = timestamps.filter((t) => t < oneWeekAgo);
    if (oldTimestamps.length > 0) {
      return {
        isValid: false,
        reason: `${oldTimestamps.length} inputs have timestamps older than one week`,
      };
    }

    return { isValid: true };
  }

  validateInputSequence(
    inputs: Array<{ timestamp: number; sequence?: number; clientId?: string }> | undefined,
    userId?: string,
  ): ValidationResult {
    if (!inputs || inputs.length === 0) {
      return { isValid: true };
    }

    // Check for duplicate timestamps (exact duplicates)
    const timestampMap = new Map<number, number>();
    for (const input of inputs) {
      const count = (timestampMap.get(input.timestamp) || 0) + 1;
      timestampMap.set(input.timestamp, count);
      if (count > 5) {
        // Allow some duplicates due to clock precision, but not many
        return {
          isValid: false,
          reason: `More than 5 inputs share the same timestamp ${input.timestamp}`,
        };
      }
    }

    // Check if timestamps are in ascending order
    for (let i = 1; i < inputs.length; i++) {
      if (inputs[i].timestamp < inputs[i - 1].timestamp) {
        return {
          isValid: false,
          reason: `Input at index ${i} has timestamp ${inputs[i].timestamp} which is before previous input ${inputs[i - 1].timestamp}`,
        };
      }
    }

    // Check for sequence numbers if present
    if (inputs[0]?.sequence !== undefined) {
      const sequences = inputs.map((i) => i.sequence);
      for (let i = 1; i < sequences.length; i++) {
        if (sequences[i] !== undefined && sequences[i - 1] !== undefined) {
          if (sequences[i] <= sequences[i - 1]) {
            return {
              isValid: false,
              reason: `Sequence number at index ${i} (${sequences[i]}) is not greater than previous (${sequences[i - 1]})`,
            };
          }
        }
      }
    }

    // Check for unrealistic input frequency (burst detection)
    const timeWindows = new Map<number, number>();
    for (const input of inputs) {
      const second = Math.floor(input.timestamp / 1000);
      timeWindows.set(second, (timeWindows.get(second) || 0) + 1);
      if ((timeWindows.get(second) || 0) > this.MAX_INPUTS_PER_SECOND) {
        return {
          isValid: false,
          reason: `More than ${this.MAX_INPUTS_PER_SECOND} inputs in one second at timestamp ${input.timestamp}`,
        };
      }
    }

    // Check for micro-bursts (high frequency in 100ms windows)
    const microWindows = new Map<number, number>();
    for (const input of inputs) {
      const window = Math.floor(input.timestamp / 100);
      microWindows.set(window, (microWindows.get(window) || 0) + 1);
      if ((microWindows.get(window) || 0) > this.MAX_INPUTS_PER_100MS) {
        return {
          isValid: false,
          reason: `More than ${this.MAX_INPUTS_PER_100MS} inputs in 100ms window at timestamp ${input.timestamp}`,
        };
      }
    }

    // Check for duplicate client IDs if present
    if (inputs[0]?.clientId) {
      const clientIdMap = new Map<string, number>();
      for (const input of inputs) {
        if (input.clientId) {
          const count = (clientIdMap.get(input.clientId) || 0) + 1;
          clientIdMap.set(input.clientId, count);
        }
      }
      // Flag if we have too many different client IDs (potential session hijacking)
      if (clientIdMap.size > 3) {
        return {
          isValid: false,
          reason: `Session contains ${clientIdMap.size} different client IDs, possible session hijacking`,
        };
      }
    }

    return { isValid: true };
  }

  async detectReplayAttack(
    sessionData: SessionData,
    userId?: string,
  ): Promise<ReplayDetectionResult> {
    if (!sessionData.sessionId || !userId) {
      return { isSuspicious: false };
    }

    // Check if this exact session payload was recently processed
    const payloadHash = this.calculatePayloadHash(sessionData);
    const replayKey = `replay:${userId}:${payloadHash}`;
    
    try {
      const existing = await this.cacheService.get(replayKey);
      if (existing) {
        return {
          isSuspicious: true,
          reason: 'Duplicate session payload detected (possible replay attack)',
          details: {
            previousSubmissionTime: existing,
            payloadHash,
          },
        };
      }

      // Store this payload for 5 minutes to detect immediate replays
      await this.cacheService.set(replayKey, Date.now(), 300000);
    } catch (error) {
      this.logger.error('Failed to check replay cache', { error, userId });
      // Don't block on cache errors, just log
    }

    // Check for signature reuse if present
    if (sessionData.signature) {
      const signatureKey = `signature:${userId}:${sessionData.signature}`;
      try {
        const existing = await this.cacheService.get(signatureKey);
        if (existing) {
          return {
            isSuspicious: true,
            reason: 'Signature reuse detected (possible replay attack)',
            details: {
              previousSubmissionTime: existing,
              signature: sessionData.signature,
            },
          };
        }
        // Store signature for 1 hour
        await this.cacheService.set(signatureKey, Date.now(), 3600000);
      } catch (error) {
        this.logger.error('Failed to check signature cache', { error, userId });
      }
    }

    // Check for rapid session submissions (potential automation/replay)
    const rateLimitKey = `session_rate:${userId}`;
    try {
      const recentSubmissions = await this.cacheService.get(rateLimitKey) as string | null;
      const submissions = recentSubmissions ? JSON.parse(recentSubmissions) : [];
      
      const now = Date.now();
      const oneMinuteAgo = now - 60000;
      const recentCount = submissions.filter((t: number) => t > oneMinuteAgo).length;
      
      if (recentCount > 10) {
        return {
          isSuspicious: true,
          reason: `High submission rate: ${recentCount} sessions in last minute`,
          details: { recentCount },
        };
      }

      // Update rate limit tracking
      submissions.push(now);
      const filtered = submissions.filter((t: number) => t > oneMinuteAgo);
      await this.cacheService.set(rateLimitKey, JSON.stringify(filtered), 120000);
    } catch (error) {
      this.logger.error('Failed to check rate limit cache', { error, userId });
    }

    return { isSuspicious: false };
  }

  private calculatePayloadHash(sessionData: SessionData): string {
    const dataToHash = {
      duration: sessionData.duration,
      inputCount: sessionData.inputs?.length || 0,
      firstTimestamp: sessionData.inputs?.[0]?.timestamp || 0,
      lastTimestamp: sessionData.inputs?.[sessionData.inputs.length - 1]?.timestamp || 0,
    };
    
    // Simple hash for detection (not cryptographic)
    return JSON.stringify(dataToHash);
  }
}
