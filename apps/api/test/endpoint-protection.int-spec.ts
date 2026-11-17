import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import {
  ANY_AUTHENTICATED_KEY,
  PERMISSIONS_KEY,
  PLATFORM_KEY,
  PUBLIC_KEY,
} from '../src/modules/auth/auth.decorators';

type Handler = (...args: unknown[]) => unknown;

interface Endpoint {
  name: string;
  markers: string[];
}

/**
 * Guards CLAUDE.md rule 4 for endpoints added in the future: every route must state who
 * may call it with exactly one of @Public, @AnyAuthenticated, @RequirePermission or, for
 * Gatefit's back office, @Platform.
 */
describe('Endpoint protection coverage', () => {
  let endpoints: Endpoint[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    const discovery = moduleRef.get(DiscoveryService);
    const reflector = moduleRef.get(Reflector);

    endpoints = discovery.getControllers().flatMap(({ metatype }) => {
      if (!metatype) {
        return [];
      }
      const prototype = (metatype as { prototype: Record<string, unknown> }).prototype;
      return Object.getOwnPropertyNames(prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => ({ name, handler: prototype[name] }))
        .filter(
          (entry): entry is { name: string; handler: Handler } =>
            typeof entry.handler === 'function' &&
            Reflect.getMetadata(PATH_METADATA, entry.handler) !== undefined,
        )
        .map(({ name, handler }) => {
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
          const has = (key: string) =>
            reflector.getAllAndOverride<unknown>(key, [handler, metatype as Handler]) !== undefined;
          return {
            name: `${RequestMethod[method]} ${metatype.name}.${name}`,
            markers: [
              has(PUBLIC_KEY) && 'Public',
              has(ANY_AUTHENTICATED_KEY) && 'AnyAuthenticated',
              has(PERMISSIONS_KEY) && 'RequirePermission',
              has(PLATFORM_KEY) && 'Platform',
            ].filter((marker): marker is string => typeof marker === 'string'),
          };
        });
    });

    await moduleRef.close();
  });

  it('finds the endpoints', () => {
    const names = endpoints.map((endpoint) => endpoint.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'GET HealthController.check',
        'POST AuthController.login',
        'GET MeController.me',
      ]),
    );
  });

  it('every endpoint declares exactly one access rule', () => {
    const offenders = endpoints
      .filter((endpoint) => endpoint.markers.length !== 1)
      .map((endpoint) => `${endpoint.name}: [${endpoint.markers.join(', ')}]`);
    expect(offenders).toEqual([]);
  });

  it('platform endpoints live under /platform and nowhere else', () => {
    const platform = endpoints.filter((endpoint) => endpoint.markers.includes('Platform'));
    expect(platform.length).toBeGreaterThan(5);
    for (const endpoint of platform) {
      expect(endpoint.name).toMatch(/ Platform\w+Controller\./);
    }
  });

  it('only the expected endpoints are public', () => {
    const publicEndpoints = endpoints
      .filter((endpoint) => endpoint.markers.includes('Public'))
      .map((endpoint) => endpoint.name)
      .sort();
    // Adding a public endpoint is a security decision: update this list deliberately.
    expect(publicEndpoints).toEqual([
      'GET HealthController.check',
      'POST AuthController.beginTotpSetup',
      'POST AuthController.confirmTotpSetup',
      'POST AuthController.login',
      'POST AuthController.logout',
      'POST AuthController.refresh',
      'POST AuthController.requestOtp',
      'POST AuthController.setPassword',
      'POST AuthController.verifyOtp',
      'POST PlatformAuthController.beginTotpSetup',
      'POST PlatformAuthController.confirmTotpSetup',
      'POST PlatformAuthController.login',
    ]);
  });
});
