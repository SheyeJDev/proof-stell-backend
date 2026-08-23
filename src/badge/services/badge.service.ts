import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  Inject,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Repository } from 'typeorm';
import {
  type Badge,
  type AchievementType,
  BadgeRarity,
} from '../entities/badge.entity';
import type { UserBadge } from '../entities/user-badge.entity';
import type { User } from '../../users/entities/user.entity';
import type { CreateBadgeDto } from '../dto/create-badge.dto';
import type { AwardBadgeDto } from '../dto/award-badge.dto';
import type {
  BadgeResponseDto,
  UserProfileBadgesDto,
  LeaderboardEntryDto,
} from '../dto/badge-response.dto';
import { IdempotencyService } from '../../common/services/idempotency.service';

@Injectable()
export class BadgeService {
  private readonly logger = new Logger(BadgeService.name);

  constructor(
    private badgeRepository: Repository<Badge>,
    private userBadgeRepository: Repository<UserBadge>,
    private userRepository: Repository<User>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async createBadge(createBadgeDto: CreateBadgeDto): Promise<Badge> {
    const existingBadge = await this.badgeRepository.findOne({
      where: { name: createBadgeDto.name },
    });

    if (existingBadge) {
      throw new ConflictException('Badge with this name already exists');
    }

    const badge = this.badgeRepository.create(createBadgeDto);
    const savedBadge = await this.badgeRepository.save(badge);

    this.logger.log(`Created new badge: ${savedBadge.name} (${savedBadge.id})`);
    return savedBadge;
  }

  async getAllBadges(includeInactive = false): Promise<Badge[]> {
    const whereCondition = includeInactive ? {} : { isActive: true };

    return await this.badgeRepository.find({
      where: whereCondition,
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }

  async getBadgesByType(type: AchievementType): Promise<Badge[]> {
    return await this.badgeRepository.find({
      where: { type, isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });
  }

  async getBadgeById(id: string): Promise<Badge> {
    const badge = await this.badgeRepository.findOne({ where: { id } });
    if (!badge) {
      throw new NotFoundException('Badge not found');
    }
    return badge;
  }

  async awardBadgeManually(
    awardBadgeDto: AwardBadgeDto,
    adminId: string,
  ): Promise<UserBadge> {
    const { userId, badgeId, metadata } = awardBadgeDto;
    const idempotencyKey = this.idempotencyService.generateKey(
      'award-badge-manually',
      `${userId}:${badgeId}`,
    );

    const cachedResult =
      await this.idempotencyService.check<UserBadge>(idempotencyKey);
    if (cachedResult) {
      return cachedResult;
    }

    // Verify user exists
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify badge exists
    const badge = await this.getBadgeById(badgeId);

    // Check if user already has this badge
    const existingUserBadge = await this.userBadgeRepository.findOne({
      where: { userId, badgeId },
    });

    if (existingUserBadge) {
      throw new ConflictException('User already has this badge');
    }

    const userBadge = this.userBadgeRepository.create({
      userId,
      badgeId,
      awardedBy: adminId,
      isManuallyAwarded: true,
      metadata: {
        ...metadata,
        context: 'manual_award',
        triggerEvent: 'admin_action',
      },
      isDisplayed: true,
    });

    const savedUserBadge = await this.userBadgeRepository.save(userBadge);

    this.logger.log(
      `Manually awarded badge "${badge.name}" to user ${user.username} by admin ${adminId}`,
    );

    await this.idempotencyService.store(idempotencyKey, savedUserBadge, 600000);
    return savedUserBadge;
  }

  async getUserBadges(userId: string): Promise<BadgeResponseDto[]> {
    const userBadges = await this.userBadgeRepository.find({
      where: { userId },
      relations: ['badge'],
      order: { awardedAt: 'DESC' },
    });

    return userBadges.map((userBadge) => this.mapToResponseDto(userBadge));
  }

  async getUserProfileBadges(userId: string): Promise<UserProfileBadgesDto> {
    const userBadges = await this.userBadgeRepository.find({
      where: { userId },
      relations: ['badge'],
      order: { awardedAt: 'DESC' },
    });

    const badgesByRarity = userBadges.reduce(
      (acc, userBadge) => {
        const rarity = userBadge.badge.rarity;
        acc[rarity] = (acc[rarity] || 0) + 1;
        return acc;
      },
      {} as Record<BadgeRarity, number>,
    );

    const totalPoints = userBadges.reduce(
      (sum, userBadge) => sum + userBadge.badge.points,
      0,
    );

    const recentBadges = userBadges
      .slice(0, 5)
      .map((userBadge) => this.mapToResponseDto(userBadge));

    const featuredBadges = userBadges
      .filter(
        (userBadge) =>
          userBadge.badge.rarity === BadgeRarity.LEGENDARY ||
          userBadge.badge.rarity === BadgeRarity.EPIC,
      )
      .slice(0, 3)
      .map((userBadge) => this.mapToResponseDto(userBadge));

    return {
      totalBadges: userBadges.length,
      totalPoints,
      badgesByRarity,
      recentBadges,
      featuredBadges,
    };
  }

  async getLeaderboardWithBadges(limit = 10): Promise<LeaderboardEntryDto[]> {
    const cacheKey = `leaderboard:withBadges:${limit}`;
    const cached = await this.cacheManager.get<LeaderboardEntryDto[]>(cacheKey);
    if (cached) return cached;
    const query = `
      SELECT 
        u.id as "userId",
        u.username,
        u.total_score as "totalScore",
        u.games_played as "gamesPlayed",
        COUNT(ub.id)::int as "badgeCount",
        COALESCE(SUM(b.points), 0)::int as "badgePoints",
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', b.id,
            'name', b.name,
            'icon', b.icon,
            'rarity', b.rarity,
            'points', b.points,
            'awardedAt', ub.awarded_at
          ) ORDER BY b.rarity DESC, ub.awarded_at DESC
        ) FILTER (WHERE b.id IS NOT NULL) as "topBadges",
        ROW_NUMBER() OVER (ORDER BY u.total_score DESC, COALESCE(SUM(b.points), 0) DESC) as rank
      FROM users u
      LEFT JOIN user_badges ub ON u.id = ub.user_id
      LEFT JOIN badges b ON ub.badge_id = b.id AND b.is_active = true
      WHERE u.is_active = true
      GROUP BY u.id, u.username, u.total_score, u.games_played
      ORDER BY u.total_score DESC, "badgePoints" DESC
      LIMIT $1
    `;

    const results = await this.userBadgeRepository.query(query, [limit]);

    const mapped = results.map((result: any) => ({
      ...result,
      topBadges: (result.topBadges || []).slice(0, 3),
    }));

    await this.cacheManager.set(cacheKey, mapped, 30); // cache for 30s
    return mapped;
  }

  async getBadgeProgress(userId: string, badgeId: string): Promise<any> {
    const badge = await this.getBadgeById(badgeId);
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!badge.criteria || !badge.isAutoAwarded) {
      return null;
    }

    const progress = await this.calculateProgress(user, badge);
    return progress;
  }

  async removeBadgeFromUser(userId: string, badgeId: string): Promise<void> {
    const userBadge = await this.userBadgeRepository.findOne({
      where: { userId, badgeId },
    });

    if (!userBadge) {
      throw new NotFoundException('User badge not found');
    }

    await this.userBadgeRepository.remove(userBadge);
    this.logger.log(`Removed badge ${badgeId} from user ${userId}`);
  }

  async updateBadge(
    id: string,
    updateData: Partial<CreateBadgeDto>,
  ): Promise<Badge> {
    const badge = await this.getBadgeById(id);

    if (updateData.name && updateData.name !== badge.name) {
      const existingBadge = await this.badgeRepository.findOne({
        where: { name: updateData.name },
      });
      if (existingBadge) {
        throw new ConflictException('Badge with this name already exists');
      }
    }

    Object.assign(badge, updateData);
    return await this.badgeRepository.save(badge);
  }

  async deactivateBadge(id: string): Promise<Badge> {
    const badge = await this.getBadgeById(id);
    badge.isActive = false;
    return await this.badgeRepository.save(badge);
  }

  private mapToResponseDto(userBadge: UserBadge): BadgeResponseDto {
    return {
      id: userBadge.badge.id,
      name: userBadge.badge.name,
      description: userBadge.badge.description,
      icon: userBadge.badge.icon,
      type: userBadge.badge.type,
      rarity: userBadge.badge.rarity,
      points: userBadge.badge.points,
      category: userBadge.badge.category,
      awardedAt: userBadge.awardedAt,
      isManuallyAwarded: userBadge.isManuallyAwarded,
      metadata: userBadge.metadata,
    };
  }

  private async calculateProgress(user: User, badge: Badge): Promise<any> {
    const { condition, value, operator = 'gte' } = badge.criteria;
    let current = 0;
    const required = value || 1;

    switch (condition) {
      case 'games_played':
        current = user.gamesPlayed;
        break;
      case 'total_score':
        current = user.totalScore;
        break;
      case 'highest_score':
        current = user.highestScore;
        break;
      case 'referrals':
        current = user.referrals;
        break;
      case 'current_streak':
        current = user.currentStreak;
        break;
      case 'longest_streak':
        current = user.longestStreak;
        break;
      default:
        return null;
    }

    const percentage = Math.min((current / required) * 100, 100);

    return {
      current,
      required,
      percentage: Math.round(percentage),
    };
  }
}
