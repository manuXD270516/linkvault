import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CreateGroupRequest,
  GroupDetail,
  GroupMember,
  GroupSummary,
  InviteCodeResponse,
  JoinGroupRequest,
  RenameGroupRequest,
} from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';

const GROUPS_URL = '/api/groups';

/**
 * Normaliza el código de invitación como `inviteCodeSchema`: espacios exteriores fuera y mayúsculas. El formato (longitud
 * y alfabeto) lo juzga la API, que responde `invalid_invite_code` (D3), así que aquí no se valida.
 *
 * Se repite la normalización en lugar de importar el schema porque `core/` viaja en el bundle inicial (presupuesto de
 * 500 kB) y zod solo puede entrar en chunks lazy, igual que en `core/api/api-error.ts`.
 */
export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Llamadas a `/api/groups`. El `Authorization: Bearer` lo pone `authInterceptor` (ninguna de estas peticiones marca
 * `SKIP_BEARER`), que también renueva la sesión ante un `401`. Solo importa tipos de `@linkvault/shared`.
 */
@Injectable({ providedIn: 'root' })
export class GroupsApi {
  private readonly http = inject(HttpClient);

  createGroup(name: string): Promise<GroupDetail> {
    const body: CreateGroupRequest = { name };
    return firstValueFrom(this.http.post<GroupDetail>(GROUPS_URL, body));
  }

  listGroups(): Promise<GroupSummary[]> {
    return firstValueFrom(this.http.get<GroupSummary[]>(GROUPS_URL));
  }

  getGroup(groupId: string): Promise<GroupDetail> {
    return firstValueFrom(this.http.get<GroupDetail>(groupUrl(groupId)));
  }

  renameGroup(groupId: string, name: string): Promise<GroupDetail> {
    const body: RenameGroupRequest = { name };
    return firstValueFrom(this.http.patch<GroupDetail>(groupUrl(groupId), body));
  }

  async deleteGroup(groupId: string): Promise<void> {
    await firstValueFrom(this.http.delete<null>(groupUrl(groupId)));
  }

  rotateInviteCode(groupId: string): Promise<InviteCodeResponse> {
    return firstValueFrom(
      this.http.post<InviteCodeResponse>(`${groupUrl(groupId)}/invite-code`, null),
    );
  }

  /** Une al usuario al grupo del código; la respuesta nunca trae el código de invitación (D5). */
  joinGroup(code: string): Promise<GroupSummary> {
    const body: JoinGroupRequest = { code: normalizeInviteCode(code) };
    return firstValueFrom(this.http.post<GroupSummary>(`${GROUPS_URL}/join`, body));
  }

  listMembers(groupId: string): Promise<GroupMember[]> {
    return firstValueFrom(this.http.get<GroupMember[]>(`${groupUrl(groupId)}/members`));
  }

  async leaveGroup(groupId: string): Promise<void> {
    await firstValueFrom(this.http.delete<null>(`${groupUrl(groupId)}/members/me`));
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<null>(`${groupUrl(groupId)}/members/${encodeURIComponent(userId)}`),
    );
  }
}

function groupUrl(groupId: string): string {
  return `${GROUPS_URL}/${encodeURIComponent(groupId)}`;
}
