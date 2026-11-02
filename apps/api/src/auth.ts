// SPDX-FileCopyrightText: © 2026 CVS Health and/or one of its affiliates.
// SPDX-License-Identifier: Apache-2.0

import { ActionType, SubjectType } from 'shared-types';
import { Pool } from 'pg';
import { betterAuth } from 'better-auth/minimal';
import { defaultAc, adminAc, ownerAc } from 'better-auth/plugins/organization/access';
import { drizzle } from 'drizzle-orm/node-postgres';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization, type OrganizationOptions } from 'better-auth/plugins';
import { organizationPluginOptions } from 'shared-constants';

import * as schema from './db/schema/auth.js';
import createOrganizationsService from 'services/organizationsService.js';
import createRepositories from 'utils/createRepositories.js';
import createTeamsService from 'services/teamsService.js';
import getCorsOrigins from './utils/getCorsOrigins.js';
import normalizeTeamName from 'utils/normalizeTeamName.js';
import { DEFAULT_ORGANIZATION } from './constants/organizations.js';
import { SYSTEM } from './constants/common.js';
import { createWithTransaction } from 'utils/withTransaction.js';
import { poolSettings } from './plugins/drizzle.js';

type HookParameters<T extends keyof NonNullable<OrganizationOptions['organizationHooks']>> = Parameters<
  NonNullable<NonNullable<OrganizationOptions['organizationHooks']>[T]>
>[0];

const pool = new Pool(poolSettings);
const db = drizzle(pool);
const withTransaction = createWithTransaction(db);

/**
 * Team membership is what grants write access (see `authorizationService.assertCanWrite`), so
 * `member` gets no `member`/`team` mutation statements. better-auth's own membership endpoints
 * therefore deny by role; team membership is managed through `/teams/:teamId/members`, which is
 * authorized per-team by the service.
 */
export const organizationRoles = {
  admin: adminAc,
  member: defaultAc.newRole({ team: ['create'] }),
  owner: ownerAc,
};

// Exported for direct unit testing since better-auth does not expose plugin hook options on `auth.options`.
export async function beforeCreateTeam({ team }: HookParameters<'beforeCreateTeam'>) {
  return {
    data: {
      ...team,
      name: normalizeTeamName(team.name),
    },
  };
}

/** The creator becomes the team's first member, which is what makes the team theirs to administer. */
export async function afterCreateTeam({ team, user }: HookParameters<'afterCreateTeam'>) {
  const repositories = createRepositories(db);

  await repositories.logsRepository.create({
    action: ActionType.Create,
    actorId: user?.id || SYSTEM,
    applicationId: null,
    newData: {
      name: team.name,
    },
    oldData: null,
    subjectId: team.id,
    subjectKey: team.name,
    subjectType: SubjectType.Team,
  });

  if (!user) {
    return;
  }

  // Bypasses teamsService.addMembers deliberately: the team has no members yet, so there is no one
  // assertCanWrite could authorize against; the creator is the actor.
  // Not in the same transaction as the team insert, so a failure here leaves a team with no members
  // rather than rolling it back.
  await repositories.teamsRepository.addMember(team.id, user.id);
}

async function addUserToDefaultTeam(userId: string, repositories: ReturnType<typeof createRepositories>) {
  const teamService = createTeamsService({
    repositories,
    withTransaction,
    // No caller to authorize against here; see hooks below. Don't reuse this instance elsewhere.
    assertCanWrite: () => Promise.resolve(),
  });
  const defaultTeam = await teamService.getTeamByName(DEFAULT_ORGANIZATION.slug);
  await teamService.addMembers(defaultTeam.id, [userId], userId);
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', usePlural: true, schema }),
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const repositories = createRepositories(db);
          const organizationService = createOrganizationsService({
            repositories,
            withTransaction,
            // This runs inside a better-auth database hook, before the request has an
            // authenticated user we can attribute the write to. The organization lookup happens
            // as part of provisioning the session itself, so there is no caller to authorize
            // against; the injected `assertCanWrite` short-circuits to a no-op for this call
            // path only. Never reuse this instance outside better-auth's hooks.
            assertCanWrite: () => Promise.resolve(),
          });
          const organization = await organizationService.getBySlug(DEFAULT_ORGANIZATION.slug);

          return {
            data: {
              ...session,
              activeOrganizationId: organization ? organization.id : null,
            },
          };
        },
      },
    },
    user: {
      create: {
        after: async (user) => {
          const repositories = createRepositories(db);
          const organizationService = createOrganizationsService({
            repositories,
            withTransaction,
            // Same reasoning as the session hook above: this runs inside a better-auth database
            // hook as part of provisioning a brand-new user, so there is no established caller
            // whose team membership we could check. The no-op `assertCanWrite` is scoped to this
            // hook and must never be reused for a normal request flow.
            assertCanWrite: () => Promise.resolve(),
          });
          const organization = await organizationService.getBySlug(DEFAULT_ORGANIZATION.slug);

          if (organization) {
            await auth.api.addMember({
              body: {
                organizationId: organization.id,
                role: 'member',
                userId: user.id,
              },
            });
            await addUserToDefaultTeam(user.id, repositories);
          } else {
            // Creates the default organization and team of the same name
            await auth.api.createOrganization({
              body: {
                name: DEFAULT_ORGANIZATION.name,
                slug: DEFAULT_ORGANIZATION.slug,
                userId: user.id,
              },
            });
          }
        },
      },
    },
  },
  plugins: [
    organization({
      ...organizationPluginOptions,
      roles: organizationRoles,
      membershipLimit: 1000000,
      organizationHooks: {
        beforeCreateTeam,
        afterCreateTeam,
      },
    }),
  ],
  trustedOrigins: getCorsOrigins(),
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },
});
