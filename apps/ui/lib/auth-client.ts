// SPDX-FileCopyrightText: © 2026 CVS Health and/or one of its affiliates.
// SPDX-License-Identifier: Apache-2.0

import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';
import { organizationPluginOptions } from 'shared-constants';

// In the browser, auth requests go to this app's own origin and proxy.ts forwards them to the API,
// so Better Auth's cookies are set on the UI's origin. Server actions call the API directly.
const baseURL = typeof window === 'undefined' ? process.env.API_BASE_URL?.replace(/\/$/, '') : window.location.origin;

export const authClient = createAuthClient({
  baseURL: baseURL || 'http://localhost:8080',
  plugins: [organizationClient(organizationPluginOptions)],
});
