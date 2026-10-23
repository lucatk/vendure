import { keepPreviousData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useContext } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiQueryMock = vi.hoisted(() => vi.fn());
const apiMutateMock = vi.hoisted(() => vi.fn());

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/vdb/graphql/api.js', () => ({ api: { query: apiQueryMock, mutate: apiMutateMock } }));

import { LS_KEY_USER_SETTINGS } from '@/vdb/constants.js';

import { UserSettingsContext, UserSettingsContextType, UserSettingsProvider } from './user-settings.js';

const forbidden = () => Promise.reject(new Error('You are not currently authorized to perform this action'));
const serverValue = (value: unknown) => Promise.resolve({ getSettingsStoreValue: value });

const savedOrderListFilters = [{ id: 'state', value: ['Shipped'] }];

/** The `value` of every settings store write so far. */
function savedValues(): any[] {
    return apiMutateMock.mock.calls.map(([, variables]) => variables.input.value);
}

describe('UserSettingsProvider', () => {
    let container: HTMLDivElement;
    let root: Root;
    let queryClient: QueryClient;
    let ctx: UserSettingsContextType;

    async function flush() {
        // Several rounds: query resolution, the init effect, the save effect and the
        // mutation each settle in a separate tick.
        for (let i = 0; i < 5; i++) {
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0));
            });
        }
    }

    async function render() {
        function Probe() {
            ctx = useContext(UserSettingsContext)!;
            return null;
        }
        await act(async () => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <UserSettingsProvider queryClient={queryClient}>
                        <Probe />
                    </UserSettingsProvider>
                </QueryClientProvider>,
            );
        });
        await flush();
    }

    /** What `AuthProvider.login` does around a successful login mutation. */
    async function login(serverSettings: unknown) {
        apiQueryMock.mockImplementation(() => serverValue(serverSettings));
        await act(async () => {
            ctx.resyncWithServer();
            ctx.setActiveChannelId('channel-1');
        });
        await act(async () => {
            await queryClient.invalidateQueries();
        });
        await flush();
    }

    beforeEach(() => {
        // An in-memory Storage, because Node >= 25 ships its own (unusable without
        // --localstorage-file) global localStorage, which shadows jsdom's.
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => store.set(key, String(value)),
            removeItem: (key: string) => store.delete(key),
            clear: () => store.clear(),
        });
        apiQueryMock.mockReset();
        apiMutateMock.mockReset();
        apiMutateMock.mockImplementation((_doc, variables) =>
            Promise.resolve({
                setSettingsStoreValue: { key: variables.input.key, result: true, error: null },
            }),
        );
        // Same placeholder behaviour as the dashboard's own client (app-providers.tsx).
        queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false, placeholderData: keepPreviousData } },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        queryClient.clear();
        vi.unstubAllGlobals();
    });

    it('does not save to the server while nobody is logged in', async () => {
        apiQueryMock.mockImplementation(forbidden);
        await render();

        await act(async () => ctx.setTableSettings('order-list', 'pageSize', 50));
        await flush();

        expect(ctx.settingsReady).toBe(true);
        expect(ctx.settings.tableSettings?.['order-list']?.pageSize).toBe(50);
        expect(apiMutateMock).not.toHaveBeenCalled();
    });

    it('applies the saved settings when logging in on a browser without local settings', async () => {
        // The provider mounts on the login page, where the settings query is FORBIDDEN.
        apiQueryMock.mockImplementation(forbidden);
        await render();

        await login({
            activeChannelId: 'channel-1',
            tableSettings: { 'order-list': { columnFilters: savedOrderListFilters } },
        });

        expect(ctx.settings.tableSettings?.['order-list']?.columnFilters).toEqual(savedOrderListFilters);
        // Nothing may have replaced the saved table settings with the empty local ones.
        for (const value of savedValues()) {
            expect(value.tableSettings?.['order-list']?.columnFilters).toEqual(savedOrderListFilters);
        }
    });

    it("loads the next user's settings instead of saving the previous user's over them", async () => {
        apiQueryMock.mockImplementation(() =>
            serverValue({ tableSettings: { 'order-list': { pageSize: 100 } } }),
        );
        await render();
        expect(ctx.settings.tableSettings?.['order-list']?.pageSize).toBe(100);

        // Logout, then another user logs in on the same browser.
        await act(async () => ctx.resyncWithServer());
        apiMutateMock.mockClear();
        await login({ tableSettings: { 'order-list': { columnFilters: savedOrderListFilters } } });

        expect(ctx.settings.tableSettings?.['order-list']).toEqual({ columnFilters: savedOrderListFilters });
        for (const value of savedValues()) {
            expect(value.tableSettings?.['order-list']?.pageSize).toBeUndefined();
        }
    });

    it('saves changes once the server settings have loaded', async () => {
        localStorage.setItem(LS_KEY_USER_SETTINGS, JSON.stringify({ tableSettings: {} }));
        apiQueryMock.mockImplementation(() => serverValue({ tableSettings: {} }));
        await render();

        await act(async () => ctx.setTableSettings('order-list', 'columnFilters', savedOrderListFilters));
        await flush();

        expect(savedValues().at(-1).tableSettings['order-list'].columnFilters).toEqual(savedOrderListFilters);
    });
});
