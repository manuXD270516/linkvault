import { Module } from '@nestjs/common';
import { Argon2PasswordHasher } from '../../auth/infrastructure/argon2-password-hasher';
import { GetMyProfile } from '../application/get-my-profile.usecase';
import { ACCOUNT_PASSWORD_VERIFIER } from '../application/ports/account-password-verifier.port';
import { USERS_CLOCK } from '../application/ports/clock.port';
import { USER_REPOSITORY } from '../application/ports/user-repository.port';
import { UpdateMyProfile } from '../application/update-my-profile.usecase';
import { UsersFacade } from '../application/users.facade';
import { MongoUserRepository } from '../infrastructure/mongo-user.repository';
import { SystemClock } from '../infrastructure/system-clock';
import { UsersController } from './users.controller';

/**
 * Módulo `users` (D1 de auth-users). Usa la conexión Mongoose por defecto. Expone `GET`/`PATCH /users/me` y exporta
 * `UsersFacade` más el repositorio y el verificador de contraseña para `AccountDeletionModule`. El borrado vive en
 * `AccountDeletionModule` (no aquí) para no importar `GroupsModule` en el mismo módulo que `GroupsModule` importa.
 */
@Module({
  controllers: [UsersController],
  providers: [
    { provide: USER_REPOSITORY, useClass: MongoUserRepository },
    { provide: USERS_CLOCK, useClass: SystemClock },
    {
      provide: ACCOUNT_PASSWORD_VERIFIER,
      useFactory: () => new Argon2PasswordHasher(),
    },
    GetMyProfile,
    UpdateMyProfile,
    UsersFacade,
  ],
  exports: [UsersFacade, USER_REPOSITORY, ACCOUNT_PASSWORD_VERIFIER],
})
export class UsersModule {}
