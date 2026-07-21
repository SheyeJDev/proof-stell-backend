import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyKey } from '../entities/idempotency-key.entity';

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly idempotencyKeyRepository: Repository<IdempotencyKey>,
  ) {}

  generateKey(operation: string, identifier: string): string {
    return `${operation}:${identifier}`;
  }

  async check<T>(key: string): Promise<T | null> {
    const record = await this.idempotencyKeyRepository.findOne({ where: { key } });
    if (!record) {
      return null;
    }
    if (record.expiresAt && record.expiresAt < new Date()) {
      await this.idempotencyKeyRepository.delete({ key });
      return null;
    }
    return record.result as T;
  }

  async store(key: string, result: Record<string, any>, ttlMs: number = 3600000): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs);
    const record = this.idempotencyKeyRepository.create({
      key,
      result,
      expiresAt,
    });
    await this.idempotencyKeyRepository.upsert(record, ['key']);
  }

  async delete(key: string): Promise<void> {
    await this.idempotencyKeyRepository.delete({ key });
  }
}
