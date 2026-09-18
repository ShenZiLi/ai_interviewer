import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { ApiModule } from './api/api.module.js';

@Module({ controllers: [AppController], imports: [ApiModule] })
export class AppModule {}