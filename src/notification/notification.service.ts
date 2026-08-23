import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity';
import { CreateNotificationDto } from './notification.dto';
import { RealtimeGateway } from '../common/gateways/realtime.gateway';
import { LoggingService } from '../logging/logging.service';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly loggingService: LoggingService,
  ) {}

  private sleep(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
  }

  private async sendWithRetry(notification: Notification) {
    const maxAttempts = Number(process.env.NOTIFICATION_MAX_ATTEMPTS) || 5;
    const baseDelay = Number(process.env.NOTIFICATION_BASE_DELAY_MS) || 100;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // provider call
        await Promise.resolve(
          this.realtimeGateway.emitNotification(
            notification.userId,
            notification.message,
            notification.type,
            notification.icon,
          ),
        );
        return;
      } catch (err) {
        this.loggingService.warn(
          `Notification send attempt ${attempt} failed for user ${notification.userId}`,
        );
        if (attempt === maxAttempts) {
          this.loggingService.error(
            'Notification delivery failed after max attempts',
            err instanceof Error ? err : new Error(String(err)),
            {
              module: 'notification',
              action: 'send',
              userId: notification.userId,
            },
          );
          return;
        }
        // exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
    }
  }

  async create(createDto: CreateNotificationDto) {
    const toCreate: Notification[] = [];

    for (const userId of createDto.userIds) {
      // Deduplicate by eventId when provided
      if (createDto.eventId) {
        const existing = await this.notificationRepo.findOne({
          where: { userId, eventId: createDto.eventId },
        });
        if (existing) {
          this.loggingService.info('Skipping duplicate notification', {
            module: 'notification',
            action: 'dedupe',
            metadata: { userId, eventId: createDto.eventId },
          });
          continue;
        }
      }

      toCreate.push(
        this.notificationRepo.create({
          userId,
          title: createDto.title,
          message: createDto.message,
          type: createDto.type,
          isRead: false,
          icon: createDto.icon,
          eventId: createDto.eventId,
        }),
      );
    }

    const saved = await this.notificationRepo.save(toCreate);

    // Send notifications with isolated provider errors and retries
    await Promise.all(
      saved.map((notification) => this.sendWithRetry(notification)),
    );

    return saved;
  }

  async listByUser(userId: string, page = 1, limit = 20) {
    return this.notificationRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async markAsRead(id: string, userId: string) {
    const notification = await this.notificationRepo.findOne({ where: { id } });
    if (!notification) throw new NotFoundException('Notification not found');
    if (notification.userId !== userId)
      throw new ForbiddenException('Access denied');

    notification.isRead = true;
    return this.notificationRepo.save(notification);
  }
}
