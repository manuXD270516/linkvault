import { Module } from '@nestjs/common';
import { GetMyProfile } from '../application/get-my-profile.usecase';
import { USERS_CLOCK } from '../application/ports/clock.port';
import { USER_REPOSITORY } from '../application/ports/user-repository.port';
import { UpdateMyProfile } from '../application/update-my-profile.usecase';
import { UsersFacade } from '../application/users.facade';
import { MongoUserRepository } from '../infrastructure/mongo-user.repository';
import { SystemClock } from '../infrastructure/system-clock';
import { UsersController } from './users.controller';

/**
 * Módulo `users` (D1 de auth-users). Usa la conexión Mongoose por defecto de la app (`getConnectionToken()`), así que
 * quien lo importa debe registrar `MongooseModule.forRoot*`. Expone `GET` y `PATCH /users/me` (protegidos por el guard global
 * de `AuthModule`) y solo exporta `UsersFacade`.
 */
@Module({
  controllers: [UsersController],
  providers: [
    { provide: USER_REPOSITORY, useClass: MongoUserRepository },
    { provide: USERS_CLOCK, useClass: SystemClock },
    GetMyProfile,
    UpdateMyProfile,
    UsersFacade,
  ],
  exports: [UsersFacade],
})
export class UsersModule {}
