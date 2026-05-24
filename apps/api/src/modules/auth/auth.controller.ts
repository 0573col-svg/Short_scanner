import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, SignupDto } from './dto/auth.dto';
import { Public } from './public.decorator';
import type { AuthResponse, AuthTokens } from './auth.types';

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  signup(@Body() body: SignupDto): Promise<AuthResponse> {
    return this.auth.signup(body.email, body.password);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto): Promise<AuthResponse> {
    return this.auth.login(body.email, body.password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken);
  }
}
