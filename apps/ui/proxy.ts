// SPDX-FileCopyrightText: © 2026 CVS Health and/or one of its affiliates.
// SPDX-License-Identifier: Apache-2.0

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_PATH_PREFIX = '/api/auth/';

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Forward Better Auth calls to the API so its cookies are set on the UI's origin. The server-side
  // requests in utils/apiRequest.ts forward the browser's cookies, which only works if the browser
  // holds the session cookie for this origin rather than the API's.
  if (pathname.startsWith(AUTH_PATH_PREFIX) && process.env.API_BASE_URL) {
    return NextResponse.rewrite(new URL(`${pathname.slice(1)}${search}`, process.env.API_BASE_URL));
  }

  const requestHeaders = new Headers(request.headers);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set('x-next-url-pathname', pathname);

  return response;
}
