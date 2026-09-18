import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { ApiModule } from './api/api.module.js';
import { AdminModule } from './admin/admin.module.js';

@Module({ controllers: [AppController], imports: [ApiModule, AdminModule] })
export class AppModule {}