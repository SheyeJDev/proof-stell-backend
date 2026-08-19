import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { UserService } from 'src/users/providers/users.service';
import { TypedConfigService } from 'src/common/config/typed-config.service';
import { AuthTokenService } from '../providers/auth-token.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: TypedConfigService,
    private readonly userService: UserService,
    private readonly authTokenService: AuthTokenService,
  ) {
    const jwtSecret = configService.jwtSecret;
    if (!jwtSecret) {
      throw new Error('JWT secret is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
      issuer: configService.jwtIssuer,
      audience: configService.jwtAudience,
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: any) {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    await this.authTokenService.assertAccessTokenIsActive(payload, token);

    const user = await this.userService.findOne(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
