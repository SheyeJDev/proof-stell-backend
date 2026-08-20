import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from '../providers/auth.service';

const mockAuthService = {
  login: jest.fn(),
  refreshTokens: jest.fn(),
  logout: jest.fn(),
  forceExpireAllSessions: jest.fn(),
  register: jest.fn(),
  resendVerificationEmail: jest.fn(),
  verifyEmail: jest.fn(),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
