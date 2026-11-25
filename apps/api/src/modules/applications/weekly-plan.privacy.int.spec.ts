import { weeklyPlanResponseSchema } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createApplicationsTestApp,
  type ApplicationsTestApp,
} from '../../test-support/applications-test-app';

// Privacidad de «Tu semana» por HTTP (tarea 4.6a de weekly-plan): de otros miembros solo sale un conteo y el grupo.
// App real, `MongoMemoryReplSet` y las tres personas de los escenarios.

describe('weekly plan privacy', () => {
  let http: ApplicationsTestApp;

  beforeAll(async () => {
    http = await createApplicationsTestApp(
      'weekly-plan-privacy',
      getMongoTestUri(),
    );
  });

  afterAll(async () => {
    await http.close();
  });

  it('response carries the chosen group count but no ids or names of other members', async () => {
    const ana = await http.authenticated('Ana Privada');
    const bob = await http.authenticated('Bob Reservado');
    const carla = await http.authenticated('Carla Secreta');
    const dan = await http.authenticated('Dan Oculto');
    const g1 = await http.createGroup(ana, 'Grupo Uno');
    const g2 = await http.createGroup(ana, 'Grupo Dos');
    await http.join(bob, g1);
    await http.join(carla, g2);
    await http.join(dan, g2);

    const url = 'https://www.linkedin.com/jobs/view/3844000001/';
    const inG1 = await http.save(ana, url, g1);
    const inG2 = await http.save(ana, url, g2);
    expect(inG2.link.id).toBe(inG1.link.id);
    const linkId = inG1.link.id;

    const flag = async (member: typeof ana, groupId: string) => {
      const response = await http.request(
        'PUT',
        `/api/groups/${groupId}/links/${linkId}/know-someone`,
        { authorization: member.authorization, body: { flagged: true } },
      );
      expect(response.statusCode).toBe(200);
    };
    await flag(bob, g1.id);
    await flag(carla, g2.id);
    await flag(dan, g2.id);
    await flag(ana, g2.id);
    await http.track(ana, linkId, 'applied');

    const response = await http.request('GET', '/api/applications/weekly-plan', {
      authorization: ana.authorization,
    });

    expect(response.statusCode).toBe(200);
    const plan = weeklyPlanResponseSchema.parse(response.json());
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({
      rule: 'ask_know_someone',
      reason: { kind: 'know_someone', count: 2, groupId: g2.id },
    });
    for (const other of [bob, carla, dan]) {
      expect(response.body).not.toContain(other.userId);
      expect(response.body).not.toContain(other.displayName);
    }
  });
});
