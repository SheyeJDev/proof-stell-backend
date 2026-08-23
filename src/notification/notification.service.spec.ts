import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Notification } from './notification.entity';
import { Repository } from 'typeorm';
import { RealtimeGateway } from '../common/gateways/realtime.gateway';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('NotificationService', () => {
  let service: NotificationService;
  let repo: Repository<Notification>;
  let gateway: RealtimeGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getRepositoryToken(Notification),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: RealtimeGateway,
          useValue: {
            emitNotification: jest.fn(),
          },
        },
        {
          provide: require('../logging/logging.service').LoggingService,
          useValue: {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            logUserAction: jest.fn(),
          },
        },
      ],
    }).compile();
    service = module.get<NotificationService>(NotificationService);
    repo = module.get<Repository<Notification>>(
      getRepositoryToken(Notification),
    );
    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    // LoggingService mock is provided above; ensure service has it
    (service as any).loggingService = module.get(
      require('../logging/logging.service').LoggingService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create and emit notifications for each user', async () => {
      const dto = {
        userIds: ['u1', 'u2'],
        title: 'Test',
        message: 'Hello',
        type: 'info',
        icon: '🔔',
      };
      const created = [
        {
          userId: 'u1',
          title: 'Test',
          message: 'Hello',
          type: 'info',
          icon: '🔔',
          isRead: false,
        },
        {
          userId: 'u2',
          title: 'Test',
          message: 'Hello',
          type: 'info',
          icon: '🔔',
          isRead: false,
        },
      ];
      (repo.create as any).mockImplementation((input: any) => ({
        ...input,
        isRead: false,
      }));
      (repo.save as any).mockResolvedValue(created);
      const result = await service.create(dto as any);
      expect(repo.create).toHaveBeenCalledTimes(2);
      expect(repo.save).toHaveBeenCalledWith(created);
      expect(gateway.emitNotification).toHaveBeenCalledTimes(2);
      expect(result).toEqual(created);
    });

    it('should skip duplicate notifications when eventId provided', async () => {
      const dto = {
        userIds: ['u1', 'u2'],
        title: 'Test',
        message: 'Hello',
        type: 'info',
        icon: '🔔',
        eventId: 'evt1',
      } as any;

      // findOne returns existing for user u2 only
      (repo.findOne as any).mockImplementation(({ where }: any) =>
        where.userId === 'u2'
          ? Promise.resolve({ id: 'existing' })
          : Promise.resolve(undefined),
      );
      (repo.create as any).mockImplementation((input: any) => ({
        ...input,
        isRead: false,
      }));
      (repo.save as any).mockImplementation(async (items: any) => items);

      const result = await service.create(dto);
      // Only one create because u2 was deduped
      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(gateway.emitNotification).toHaveBeenCalledTimes(1);
      expect(result.length).toBe(1);
    });

    it('should continue sending when one provider fails', async () => {
      process.env.NOTIFICATION_MAX_ATTEMPTS = '1';
      const dto = {
        userIds: ['u1', 'u2'],
        title: 'Test',
        message: 'Hello',
        type: 'info',
        icon: '🔔',
      } as any;
      (repo.create as any).mockImplementation((input: any) => ({
        ...input,
        isRead: false,
      }));
      const created = [
        {
          userId: 'u1',
          title: 'Test',
          message: 'Hello',
          type: 'info',
          icon: '🔔',
          isRead: false,
        },
        {
          userId: 'u2',
          title: 'Test',
          message: 'Hello',
          type: 'info',
          icon: '🔔',
          isRead: false,
        },
      ];
      (repo.save as any).mockResolvedValue(created);

      // Make gateway throw for u2
      (gateway.emitNotification as any).mockImplementation((userId: string) => {
        if (userId === 'u2') throw new Error('provider error');
        return undefined;
      });

      const logging = (service as any).loggingService;
      const result = await service.create(dto);
      expect(gateway.emitNotification).toHaveBeenCalled();
      // Ensure u1 sent and u2 attempted and logged error
      expect(gateway.emitNotification).toHaveBeenCalledWith(
        'u1',
        'Hello',
        'info',
        '🔔',
      );
      expect(logging.error).toHaveBeenCalled();
      expect(result).toEqual(created);
    });
  });

  describe('listByUser', () => {
    it('should return notifications for a user', async () => {
      const notifs = [{ id: 'n1', userId: 'u1' }];
      (repo.find as any).mockResolvedValue(notifs);
      const result = await service.listByUser('u1', 1, 10);
      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 10,
      });
      expect(result).toBe(notifs);
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const notif = { id: 'n1', userId: 'u1', isRead: false };
      (repo.findOne as any).mockResolvedValue(notif);
      (repo.save as any).mockResolvedValue({ ...notif, isRead: true });
      const result = await service.markAsRead('n1', 'u1');
      expect(result.isRead).toBe(true);
    });
    it('should throw NotFoundException if not found', async () => {
      (repo.findOne as any).mockResolvedValue(undefined);
      await expect(service.markAsRead('bad', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });
    it('should throw ForbiddenException if userId does not match', async () => {
      (repo.findOne as any).mockResolvedValue({ id: 'n1', userId: 'other' });
      await expect(service.markAsRead('n1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
