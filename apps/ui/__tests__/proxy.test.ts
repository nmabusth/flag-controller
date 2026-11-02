// SPDX-FileCopyrightText: © 2026 CVS Health and/or one of its affiliates.
// SPDX-License-Identifier: Apache-2.0

import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { proxy } from '../proxy';

describe('proxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should successfully setup proxy', () => {
    const response = proxy(
      new NextRequest({
        pathname: '/test',
        hostname: 'localhost',
        hash: '',
        host: 'localhost',
        protocol: 'http',
        search: '',
        url: 'http://localhost/test',
        origin: 'http://localhost',
        href: 'http://localhost/test',
        password: '',
        username: '',
        searchParams: new URLSearchParams(),
        port: '',
        toJSON: () => 'http://localhost/test',
      }),
    );

    expect(response.headers.get('x-next-url-pathname')).toEqual('/test');
  });

  it('should rewrite auth requests to the API', () => {
    vi.stubEnv('API_BASE_URL', 'https://api.example.com/');

    const response = proxy(new NextRequest('http://localhost/api/auth/callback/github?code=abc&state=xyz'));

    expect(response.headers.get('x-middleware-rewrite')).toEqual(
      'https://api.example.com/api/auth/callback/github?code=abc&state=xyz',
    );
  });

  it('should not rewrite auth requests when API_BASE_URL is not set', () => {
    vi.stubEnv('API_BASE_URL', '');

    const response = proxy(new NextRequest('http://localhost/api/auth/get-session'));

    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('x-next-url-pathname')).toEqual('/api/auth/get-session');
  });

  it('should not rewrite non-auth requests', () => {
    vi.stubEnv('API_BASE_URL', 'https://api.example.com/');

    const response = proxy(new NextRequest('http://localhost/flags'));

    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
