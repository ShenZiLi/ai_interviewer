import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { credentialsSchema } from '@ai-interviewer/contracts';
import { PrismaService } from '../common/prisma.service.js';
@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly jwt: JwtService,
  ) {}
  async register(input: unknown) {
    const data = credentialsSchema.parse(input);
    const exists = await this.db.user.findUnique({ where: { username: data.username } });
    if (exists) throw new ConflictException('USERNAME_TAKEN');
    const user = await this.db.user.create({
      data: {
        username: data.username,
        credential: {
          create: { passwordHash: await argon2.hash(data.password, { type: argon2.argon2id }) },
        },
      },
    });
    return this.issue(user.id, user.username);
  }
  async login(input: unknown) {
    const data = credentialsSchema.parse(input);
    const user = await this.db.user.findUnique({
      where: { username: data.username },
      include: { credential: true },
    });
    if (!user?.credential || !(await argon2.verify(user.credential.passwordHash, data.password)))
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    return this.issue(user.id, user.username);
  }
  private issue(id: string, username: string) {
    return { accessToken: this.jwt.sign({ sub: id, username }), user: { id, username } };
  }
}
