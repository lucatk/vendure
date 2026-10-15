import { Readable } from 'node:stream';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { AssetServer } from './asset-server';
import { S3AssetStorageStrategy } from './config/s3-asset-storage-strategy';

/**
 * The transformed-image cache key is the one object name the AssetServer derives from a
 * stored Asset identifier rather than from a bare file name. With a `keyPrefix` configured
 * the identifier already carries the prefix and a write applies it again, so the composed
 * name has to be stripped for the write and prefixed for the read, or the cache is written
 * at one key and looked up at another: every request then misses, re-runs sharp, and leaves
 * one more unreachable object in the bucket.
 */
describe('AssetServer transformed-image cache key', () => {
    function createJpeg(): Promise<Buffer> {
        return sharp({ create: { width: 20, height: 20, channels: 3, background: '#f00' } })
            .jpeg()
            .toBuffer();
    }

    /**
     * An S3 strategy over an in-memory bucket. `Upload.done()` resolves with the key it was
     * given, matching the real strategy's contract: the identifier a write returns is the key
     * the object landed under, and that is what `StoredMediaService` persists as the Asset's
     * `source`/`preview`.
     */
    function createStrategyWithBucket(keyPrefix?: string) {
        const bucket = new Map<string, Buffer>();
        class GetObjectCommand {
            constructor(public input: any) {}
        }
        const strategy = new S3AssetStorageStrategy(
            { bucket: 'test', credentials: null as any, keyPrefix },
            () => '',
        );
        (strategy as any).AWS = { GetObjectCommand };
        (strategy as any).s3Client = {
            send: vi.fn((command: any) => {
                const contents = bucket.get(command.input.Key);
                return contents === undefined
                    ? Promise.reject(
                          Object.assign(new Error('NoSuchKey'), {
                              name: 'NoSuchKey',
                              $metadata: { httpStatusCode: 404 },
                          }),
                      )
                    : Promise.resolve({ Body: Readable.from([contents]) });
            }),
        };
        (strategy as any).libStorage = {
            Upload: class {
                constructor(private config: { params: any }) {}
                done() {
                    const { Key, Body } = this.config.params;
                    bucket.set(Key, Body as Buffer);
                    return Promise.resolve({ Key });
                }
            },
        };
        return { strategy, bucket };
    }

    function createServer(strategy: S3AssetStorageStrategy) {
        const server = new AssetServer(
            {} as any,
            { assetOptions: { assetStorageStrategy: strategy } } as any,
            {} as any,
        );
        server.createAssetServer({ presets: [], imageTransformStrategies: [] });
        // Normally set by `onApplicationBootstrap`, which also ensures the local cache dir.
        (server as any).cacheHeader = 'public, max-age=1';
        return server;
    }

    /**
     * Runs one request through the two handlers the router chains: the serving path, and the
     * error handler which generates and caches a transformed image when it 404s.
     */
    async function request(server: AssetServer, path: string, query: Record<string, string>) {
        const req = { path, query } as any;
        const res: any = {
            statusCode: 200,
            body: undefined as unknown,
            contentType: vi.fn(),
            set: vi.fn(),
            setHeader: vi.fn(),
            status: vi.fn((code: number) => {
                res.statusCode = code;
                return res;
            }),
            send: vi.fn((body: unknown) => {
                res.body = body;
                return res;
            }),
        };
        let notFound: any;
        await (server as any).sendAsset()(req, res, (err: any) => {
            notFound = err;
        });
        if (notFound) {
            await (server as any).generateTransformedImage()(notFound, req, res, () => undefined);
        }
        return { res, generated: !!notFound };
    }

    const cacheKey = (prefix: string) =>
        new RegExp(`^${prefix}cache/preview/ab/image[0-9a-f]{32}\\.jpg$`);

    it('serves the second transformed request from cache when a keyPrefix is set', async () => {
        const { strategy, bucket } = createStrategyWithBucket('shop-a/');
        const server = createServer(strategy);
        const identifier = await strategy.writeFileFromBuffer('preview/ab/image.jpg', await createJpeg());
        expect(identifier).toBe('shop-a/preview/ab/image.jpg');

        const first = await request(server, `/${identifier}`, { w: '100' });

        expect(first.generated).toBe(true);
        expect(first.res.body).toBeInstanceOf(Buffer);
        expect([...bucket.keys()]).toEqual([
            'shop-a/preview/ab/image.jpg',
            expect.stringMatching(cacheKey('shop-a/')),
        ]);

        const second = await request(server, `/${identifier}`, { w: '100' });

        // The cache hit is the whole point: no transform ran, and no second object was written.
        expect(second.generated).toBe(false);
        expect(second.res.body).toEqual(first.res.body);
        expect(bucket.size).toBe(2);
    });

    it('caches under the prefix for an asset stored before the prefix was configured', async () => {
        const { strategy, bucket } = createStrategyWithBucket('shop-a/');
        const server = createServer(strategy);
        bucket.set('preview/ab/image.jpg', await createJpeg());

        const first = await request(server, '/preview/ab/image.jpg', { w: '100' });
        const second = await request(server, '/preview/ab/image.jpg', { w: '100' });

        expect(first.generated).toBe(true);
        expect(second.generated).toBe(false);
        expect([...bucket.keys()]).toEqual([
            'preview/ab/image.jpg',
            expect.stringMatching(cacheKey('shop-a/')),
        ]);
    });

    it('serves an untransformed request straight from the stored identifier', async () => {
        const { strategy, bucket } = createStrategyWithBucket('shop-a/');
        const server = createServer(strategy);
        const contents = await createJpeg();
        const identifier = await strategy.writeFileFromBuffer('preview/ab/image.jpg', contents);

        const result = await request(server, `/${identifier}`, {});

        expect(result.generated).toBe(false);
        expect(result.res.body).toEqual(contents);
        expect(bucket.size).toBe(1);
    });

    it('is unchanged with no keyPrefix configured', async () => {
        const { strategy, bucket } = createStrategyWithBucket();
        const server = createServer(strategy);
        const identifier = await strategy.writeFileFromBuffer('preview/ab/image.jpg', await createJpeg());
        expect(identifier).toBe('preview/ab/image.jpg');

        const first = await request(server, `/${identifier}`, { w: '100' });
        const second = await request(server, `/${identifier}`, { w: '100' });

        expect(first.generated).toBe(true);
        expect(second.generated).toBe(false);
        expect([...bucket.keys()]).toEqual([
            'preview/ab/image.jpg',
            expect.stringMatching(cacheKey('')),
        ]);
    });
});
