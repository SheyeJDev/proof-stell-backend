import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import sharp, { Metadata } from 'sharp';
import * as path from 'path';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_DIMENSION = 4096;
const AVATAR_SIZE = 200;
const AVATAR_ROUTE = '/avatars';
const AVATAR_DIR = path.join(process.cwd(), 'public', 'avatars');
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif']);

type SupportedSignature = 'jpeg' | 'png' | 'gif';

@Injectable()
export class AvatarService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async uploadAndSaveAvatar(userId: string, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({
        code: 'AVATAR_FILE_REQUIRED',
        message: 'Avatar file is required',
      });
    }

    this.validateDeclaredFile(file);
    const signature = this.detectSignature(file.buffer);
    if (!signature) {
      throw new BadRequestException({
        code: 'AVATAR_INVALID_SIGNATURE',
        message: 'Avatar file content is not a supported image',
      });
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const metadata = await this.readImageMetadata(file.buffer, signature);
    if (!metadata.width || !metadata.height) {
      throw new BadRequestException({
        code: 'AVATAR_INVALID_DIMENSIONS',
        message: 'Avatar image dimensions could not be determined',
      });
    }
    if (
      metadata.width > MAX_AVATAR_DIMENSION ||
      metadata.height > MAX_AVATAR_DIMENSION
    ) {
      throw new BadRequestException({
        code: 'AVATAR_DIMENSIONS_TOO_LARGE',
        message: `Avatar dimensions must not exceed ${MAX_AVATAR_DIMENSION}x${MAX_AVATAR_DIMENSION}`,
      });
    }

    const filename = this.createAvatarFilename(userId);
    const filePath = path.join(AVATAR_DIR, filename);
    const previousAvatarUrl = user.avatarUrl;

    await fs.mkdir(AVATAR_DIR, { recursive: true });

    try {
      await sharp(file.buffer)
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, {
          fit: sharp.fit.cover,
          position: sharp.strategy.attention,
        })
        .webp({ quality: 80 })
        .toFile(filePath);
    } catch (error) {
      throw new BadRequestException({
        code: 'AVATAR_PROCESSING_FAILED',
        message: 'Avatar file could not be processed as an image',
      });
    }

    const avatarUrl = `${AVATAR_ROUTE}/${filename}`;
    user.avatarUrl = avatarUrl;

    try {
      await this.userRepository.save(user);
    } catch (error) {
      await this.safeUnlink(filePath);
      throw new InternalServerErrorException('Failed to save avatar');
    }

    await this.deleteLocalAvatar(previousAvatarUrl, avatarUrl);

    return { message: 'Avatar uploaded successfully', avatarUrl };
  }

  getDefaultAvatarUrl(): string {
    return '/avatars/default-avatar.png';
  }

  private validateDeclaredFile(file: Express.Multer.File): void {
    if (!file.buffer?.length) {
      throw new BadRequestException({
        code: 'AVATAR_FILE_REQUIRED',
        message: 'Avatar file is empty',
      });
    }
    if (file.size > MAX_AVATAR_BYTES || file.buffer.length > MAX_AVATAR_BYTES) {
      throw new BadRequestException({
        code: 'AVATAR_FILE_TOO_LARGE',
        message: 'Avatar file must be 2MB or smaller',
      });
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException({
        code: 'AVATAR_INVALID_MIME_TYPE',
        message: 'Avatar file must be a JPEG, PNG, or GIF image',
      });
    }
  }

  private detectSignature(buffer: Buffer): SupportedSignature | null {
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'jpeg';
    }

    if (
      buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      return 'png';
    }

    if (
      buffer.length >= 6 &&
      (buffer.subarray(0, 6).equals(Buffer.from('GIF87a')) ||
        buffer.subarray(0, 6).equals(Buffer.from('GIF89a')))
    ) {
      return 'gif';
    }

    return null;
  }

  private async readImageMetadata(
    buffer: Buffer,
    expectedFormat: SupportedSignature,
  ): Promise<Metadata> {
    try {
      const metadata = await sharp(buffer, { failOn: 'warning' }).metadata();
      const actualFormat =
        (metadata.format as string) === 'jpg'
          ? 'jpeg'
          : (metadata.format as string);
      if (actualFormat !== expectedFormat) {
        throw new Error('Image signature and decoder format do not match');
      }
      return metadata;
    } catch (error) {
      throw new BadRequestException({
        code: 'AVATAR_INVALID_IMAGE',
        message: 'Avatar file content is not a valid image',
      });
    }
  }

  private createAvatarFilename(userId: string): string {
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    return `${safeUserId || 'user'}-${randomUUID()}-avatar.webp`;
  }

  private async deleteLocalAvatar(
    previousAvatarUrl: string | undefined,
    replacementAvatarUrl: string,
  ): Promise<void> {
    if (
      !previousAvatarUrl ||
      previousAvatarUrl === replacementAvatarUrl ||
      !previousAvatarUrl.startsWith(`${AVATAR_ROUTE}/`)
    ) {
      return;
    }

    const filename = path.basename(previousAvatarUrl);
    if (filename !== previousAvatarUrl.slice(AVATAR_ROUTE.length + 1)) {
      return;
    }

    await this.safeUnlink(path.join(AVATAR_DIR, filename));
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
