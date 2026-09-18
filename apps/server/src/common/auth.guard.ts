import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string }; user?: { sub: string } }>();
    const token = req.headers.authorization?.replace(/^Bearer\s+/, '');
    if (!token) throw new UnauthorizedException();
    try {
      req.user = this.jwt.verify<{ sub: string }>(token);
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
