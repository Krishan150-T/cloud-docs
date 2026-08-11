import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const databaseConfig: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    type: 'postgres',
    host: configService.get<string>('database.host'),
    port: configService.get<number>('database.port'),
    username: configService.get<string>(
      'database.username'),
    password: configService.get<string>('database.password'),
    database: configService.get<string>('database.name'),
    synchronize: true,
    autoLoadEntities: true,
    ssl: { rejectUnauthorized: false },
  }),
};
