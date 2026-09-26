import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { ApiModule } from './api/api.module.js';
import { AdminModule } from './admin/admin.module.js';
import { ComposeErrorFilter, HttpErrorFilter, ZodFilter } from './app-exception.filter.js';

@Module({
  imports: [ApiModule, AdminModule],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: ZodFilter },
    { provide: APP_FILTER, useClass: ComposeErrorFilter },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule {}
