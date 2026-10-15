import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { S3AssetStorageStrategy } from './s3-asset-storage-strategy';

describe('S3AssetStorageStrategy', () => {
    function createStrategyWithUploadSpy(extraConfig: Record<string, any> = {}) {
        const uploadParams: any[] = [];
        const strategy = new S3AssetStorageStrategy(
            { bucket: 'test', credentials: null as any, ...extraConfig },
            () => '',
        );
        (strategy as any).libStorage = {
            Upload: class {
                constructor(config: { params: any }) {
                    uploadParams.push(config.params);
                }
                done() {
                    return Promise.resolve({ Key: uploadParams[uploadParams.length - 1].Key });
                }
            },
        };
        return { strategy, uploadParams };
    }

    /**
     * Stands in for a bucket holding the given keys. S3 keys are opaque strings, so a key
     * containing backslashes is a different object from the same key containing forward
     * slashes, and DeleteObject reports success whether or not the key was there.
     */
    function createStrategyWithBucket(keys: Record<string, string>, extraConfig: Record<string, any> = {}) {
        const bucket = new Map(Object.entries(keys));
        const notFound = (name: string) =>
            Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
        class GetObjectCommand {
            constructor(public input: any) {}
        }
        class HeadObjectCommand {
            constructor(public input: any) {}
        }
        class DeleteObjectCommand {
            constructor(public input: any) {}
        }
        const strategy = new S3AssetStorageStrategy(
            { bucket: 'test', credentials: null as any, ...extraConfig },
            () => '',
        );
        (strategy as any).AWS = { GetObjectCommand, HeadObjectCommand, DeleteObjectCommand };
        (strategy as any).s3Client = {
            send: vi.fn((command: any) => {
                const key = command.input.Key;
                if (command instanceof GetObjectCommand) {
                    const contents = bucket.get(key);
                    return contents === undefined
                        ? Promise.reject(notFound('NoSuchKey'))
                        : Promise.resolve({ Body: Readable.from([Buffer.from(contents)]) });
                }
                if (command instanceof HeadObjectCommand) {
                    return bucket.has(key) ? Promise.resolve({}) : Promise.reject(notFound('NotFound'));
                }
                if (command instanceof DeleteObjectCommand) {
                    bucket.delete(key);
                    return Promise.resolve({});
                }
                return Promise.reject(new Error(`Unexpected command ${command.constructor.name}`));
            }),
        };
        // `Upload.done()` resolves with the `Key` it was given, so the identifier the
        // strategy returns from a write is the key the object actually landed under.
        (strategy as any).libStorage = {
            Upload: class {
                constructor(private config: { params: any }) {}
                done() {
                    const { Key, Body } = this.config.params;
                    bucket.set(Key, String(Body));
                    return Promise.resolve({ Key });
                }
            },
        };
        return { strategy, bucket };
    }

    it('sets ContentType from the file extension', async () => {
        const { strategy, uploadParams } = createStrategyWithUploadSpy();

        await strategy.writeFileFromBuffer('some-file.pdf', Buffer.from(''));

        expect(uploadParams[0].ContentType).toBe('application/pdf');
    });

    it('falls back to application/octet-stream for unknown extensions', async () => {
        const { strategy, uploadParams } = createStrategyWithUploadSpy();

        await strategy.writeFileFromStream('some-file.unknown-ext', Buffer.from('') as any);

        expect(uploadParams[0].ContentType).toBe('application/octet-stream');
    });

    // #3197 - `readFile` and `fileExists` resolve a forward-slash identifier to the legacy
    // backslash key, so `deleteFile` has to remove that key too or the asset survives a
    // delete that reported success.
    it('deletes the legacy backslash key as well as the normalized one', async () => {
        const { strategy, bucket } = createStrategyWithBucket({ 'source\\ab\\image.jpg': 'legacy asset' });

        await strategy.deleteFile('source/ab/image.jpg');

        expect([...bucket.keys()]).toEqual([]);
        expect(await strategy.fileExists('source/ab/image.jpg')).toBe(false);
        await expect(strategy.readFileToBuffer('source/ab/image.jpg')).rejects.toThrow('NoSuchKey');
    });

    it('deletes both key forms when the asset exists under each', async () => {
        const { strategy, bucket } = createStrategyWithBucket({
            'source/ab/image.jpg': 'current asset',
            'source\\ab\\image.jpg': 'legacy asset',
        });

        await strategy.deleteFile('source/ab/image.jpg');

        expect([...bucket.keys()]).toEqual([]);
    });

    it('issues a single delete for an identifier with no separator', async () => {
        const { strategy } = createStrategyWithBucket({ 'image.jpg': 'asset' });

        await strategy.deleteFile('image.jpg');

        expect((strategy as any).s3Client.send).toHaveBeenCalledOnce();
    });

    // #3197 - a bucket policy without `s3:ListBucket` makes S3 answer 403 instead of 404 for
    // a key that is not there, and `generateUniqueName` in the core AssetService calls
    // `fileExists` on every upload, so throwing here fails uploads that used to succeed.
    it('treats a non-404 error as not found rather than throwing', async () => {
        const { strategy } = createStrategyWithBucket({});
        (strategy as any).s3Client.send = vi.fn().mockRejectedValue(
            Object.assign(new Error('AccessDenied'), {
                name: 'AccessDenied',
                $metadata: { httpStatusCode: 403 },
            }),
        );

        await expect(strategy.fileExists('source/ab/image.jpg')).resolves.toBe(false);
    });

    it('propagates a delete failure rather than reporting success', async () => {
        const { strategy } = createStrategyWithBucket({});
        (strategy as any).s3Client.send = vi.fn().mockRejectedValue(
            Object.assign(new Error('AccessDenied'), {
                name: 'AccessDenied',
                $metadata: { httpStatusCode: 403 },
            }),
        );

        await expect(strategy.deleteFile('source/ab/image.jpg')).rejects.toThrow('AccessDenied');
    });

    /**
     * `keyPrefix` is applied exactly once, where a bare file name becomes an object key: the
     * upload, and the `fileExists` probe of a name not yet written. The key the upload
     * produces is what `StoredMediaService` persists as the Asset identifier, so the read and
     * delete paths receive it already prefixed and must pass it through untouched. Prefixing
     * there as well would address `<prefix><prefix><key>`, so these cases pin both halves:
     * the two name-shaped entry points prefix, the two identifier-shaped ones do not.
     */
    describe('keyPrefix', () => {
        it('writes under the prefixed key and returns it as the identifier', async () => {
            const { strategy, uploadParams } = createStrategyWithUploadSpy({ keyPrefix: 'shop-a/' });

            const identifier = await strategy.writeFileFromBuffer('source/ab/image.jpg', Buffer.from(''));

            expect(uploadParams[0].Key).toBe('shop-a/source/ab/image.jpg');
            expect(identifier).toBe('shop-a/source/ab/image.jpg');
        });

        it('reads back the identifier a write returned', async () => {
            const { strategy } = createStrategyWithBucket({}, { keyPrefix: 'shop-a/' });

            const identifier = await strategy.writeFileFromBuffer(
                'source/ab/image.jpg',
                Buffer.from('contents'),
            );

            await expect(strategy.readFileToBuffer(identifier)).resolves.toEqual(Buffer.from('contents'));
        });

        it('deletes the identifier a write returned', async () => {
            const { strategy, bucket } = createStrategyWithBucket({}, { keyPrefix: 'shop-a/' });

            const identifier = await strategy.writeFileFromBuffer(
                'source/ab/image.jpg',
                Buffer.from('contents'),
            );
            await strategy.deleteFile(identifier);

            expect([...bucket.keys()]).toEqual([]);
        });

        it('leaves a stored identifier unprefixed on read and delete', async () => {
            const { strategy, bucket } = createStrategyWithBucket(
                { 'shop-a/source/ab/image.jpg': 'contents' },
                { keyPrefix: 'shop-a/' },
            );

            await expect(strategy.readFileToBuffer('shop-a/source/ab/image.jpg')).resolves.toEqual(
                Buffer.from('contents'),
            );
            await strategy.deleteFile('shop-a/source/ab/image.jpg');
            expect([...bucket.keys()]).toEqual([]);
        });

        // An asset uploaded before the prefix was configured has a prefix-free identifier,
        // and has to keep resolving.
        it('reads an identifier stored before the prefix was configured', async () => {
            const { strategy } = createStrategyWithBucket(
                { 'source/ab/image.jpg': 'contents' },
                { keyPrefix: 'shop-a/' },
            );

            await expect(strategy.readFileToBuffer('source/ab/image.jpg')).resolves.toEqual(
                Buffer.from('contents'),
            );
        });

        it('probes the prefixed key for a name which has not been written yet', async () => {
            const { strategy } = createStrategyWithBucket(
                { 'shop-a/source/ab/image.jpg': 'contents' },
                { keyPrefix: 'shop-a/' },
            );

            await expect(strategy.fileExists('source/ab/image.jpg')).resolves.toBe(true);
        });

        it('treats a name free in its own prefix as free, whatever another prefix holds', async () => {
            const { strategy } = createStrategyWithBucket(
                { 'shop-b/source/ab/image.jpg': 'contents' },
                { keyPrefix: 'shop-a/' },
            );

            await expect(strategy.fileExists('source/ab/image.jpg')).resolves.toBe(false);
        });
    });
});
