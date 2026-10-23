import { LS_KEY_USER_SETTINGS } from '@/vdb/constants.js';
import { QueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { ColumnFiltersState } from '@tanstack/react-table';
import React, { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { uiConfig } from 'virtual:vendure-ui-config';
import { api } from '../graphql/api.js';
import {
    getSettingsStoreValueDocument,
    setSettingsStoreValueDocument,
} from '../graphql/settings-store-operations.js';
import { Theme } from './theme-provider.js';

export interface TableSettings {
    columnVisibility?: Record<string, boolean>;
    columnOrder?: string[];
    columnFilters?: ColumnFiltersState;
    pageSize?: number;
}

/**
 * @description
 * A persisted Insights widget instance. Stores the layout and any per-instance
 * config overrides for a single widget instance, keyed by `instanceId`.
 */
export interface PersistedWidgetInstance {
    instanceId: string;
    widgetId: string;
    layout: { x: number; y: number; w: number; h: number };
    config?: Record<string, unknown>;
}

export interface UserSettings {
    displayLanguage: string;
    displayLocale?: string;
    contentLanguage: string;
    theme: Theme;
    displayUiExtensionPoints: boolean;
    mainNavExpanded: boolean;
    activeChannelId: string;
    devMode: boolean;
    hasSeenOnboarding: boolean;
    tableSettings?: Record<string, TableSettings>;
    /**
     * @deprecated Superseded by `widgetInstances`. Still read as a fallback so existing
     * saved layouts migrate transparently on load; no longer written to.
     */
    widgetLayout?: Record<string, { x: number; y: number; w: number; h: number }>;
    /**
     * @description
     * The persisted Insights widget instances, storing each instance's layout and any
     * per-instance config overrides. Replaces `widgetLayout`.
     */
    widgetInstances?: PersistedWidgetInstance[];
    /**
     * @description
     * The ids of Insights widgets the user has hidden. Uses a hidden-list model so that
     * newly registered widgets are visible by default with no migration needed.
     */
    hiddenWidgets?: string[];
}

const defaultSettings: UserSettings = {
    displayLanguage: uiConfig.i18n.defaultLanguage || 'en',
    displayLocale: uiConfig.i18n.defaultLocale,
    contentLanguage: 'en',
    theme: 'system',
    displayUiExtensionPoints: false,
    mainNavExpanded: true,
    activeChannelId: '',
    devMode: false,
    hasSeenOnboarding: false,
    tableSettings: {},
};

export interface UserSettingsContextType {
    /**
     * @description
     * Whether the server-side SettingsStore is available to use
     * (i.e. the Vendure instance has the DashboardPlugin configured)
     */
    settingsStoreIsAvailable: boolean;
    /**
     * @description
     * Whether the settings have finished resolving — either the server-side value has
     * loaded, or the SettingsStore was determined to be unavailable and local settings
     * are in effect. Consumers that initialize state from settings (e.g. the Insights
     * page draft) should wait for this before their one-shot initialization, so they
     * seed from the authoritative (server) values rather than the transient local ones.
     */
    settingsReady: boolean;
    /**
     * @description
     * Discards the server-side state the provider has synced against and stops saving to
     * the server until the settings of the current session have been fetched again. Called
     * by the auth provider whenever the session changes (login, logout), because the
     * settings store value is scoped to the logged-in user: without it, the settings of the
     * previous session (or of nobody, before login) would be written over the new user's
     * saved settings.
     */
    resyncWithServer: () => void;
    settings: UserSettings;
    setDisplayLanguage: (language: string) => void;
    setDisplayLocale: (locale: string | undefined) => void;
    setContentLanguage: (language: string) => void;
    setTheme: (theme: Theme) => void;
    setDisplayUiExtensionPoints: (display: boolean) => void;
    setMainNavExpanded: (expanded: boolean) => void;
    setActiveChannelId: (channelId: string) => void;
    setDevMode: (devMode: boolean) => void;
    setHasSeenOnboarding: (hasSeen: boolean) => void;
    setTableSettings: <K extends keyof TableSettings>(
        tableId: string,
        key: K,
        value: TableSettings[K],
    ) => void;
    /**
     * @deprecated Superseded by `saveWidgetInstanceLayouts`. The legacy `widgetLayout` field it
     * writes to is only read as a migration fallback and is no longer written by the Insights page.
     */
    setWidgetLayout: (layoutConfig: Record<string, { x: number; y: number; w: number; h: number }>) => void;
    /**
     * @description
     * Persists the layout for the given widget instances, preserving each instance's
     * existing config. The passed `layouts` are treated as the complete set of instances
     * for every widget in `loadedWidgetIds`, so any previously-persisted instance whose
     * widget was loaded but is no longer present (e.g. a removed multi-instance widget) is
     * dropped. Instances belonging to widgets that were not loaded (e.g. permission-filtered
     * ones) are preserved untouched. Used when committing the Insights layout on "Save Layout".
     */
    saveWidgetInstanceLayouts: (
        layouts: Array<Pick<PersistedWidgetInstance, 'instanceId' | 'widgetId' | 'layout' | 'config'>>,
        loadedWidgetIds: string[],
    ) => void;
    /**
     * @description
     * Persists the config override for a single widget instance immediately, preserving
     * its layout. Creates the instance entry if it does not yet exist.
     */
    updateWidgetInstanceConfig: (params: {
        instanceId: string;
        widgetId: string;
        layout: { x: number; y: number; w: number; h: number };
        config: Record<string, unknown>;
    }) => void;
    setHiddenWidgets: (widgetIds: string[]) => void;
}

export const UserSettingsContext = createContext<UserSettingsContextType | undefined>(undefined);

const SETTINGS_STORE_KEY = 'vendure.dashboard.userSettings';

interface UserSettingsProviderProps {
    queryClient?: QueryClient;
    children: React.ReactNode;
}

export const UserSettingsProvider: React.FC<UserSettingsProviderProps> = ({ queryClient, children }) => {
    // Load settings from localStorage or use defaults
    const loadSettings = (): UserSettings => {
        try {
            const storedSettings = localStorage.getItem(LS_KEY_USER_SETTINGS);
            if (storedSettings) {
                return { ...defaultSettings, ...JSON.parse(storedSettings) };
            }
        } catch (e) {
            console.error('Failed to load user settings from localStorage', e);
        }
        return { ...defaultSettings };
    };

    const [settings, setSettings] = useState<UserSettings>(loadSettings);
    const [settingsStoreIsAvailable, setSettingsStoreIsAvailable] = useState<boolean>(true);
    const [serverSettings, setServerSettings] = useState<UserSettings | null>(null);
    // `isReady`: the settings are in sync with the server value of the current session, so
    // changes may be saved to the server. `isResolved`: the first load has settled one way or
    // the other (see `settingsReady`), which is all consumers need to wait for.
    const [isReady, setIsReady] = useState(false);
    const [isResolved, setIsResolved] = useState(false);
    const previousContentLanguage = useRef(settings.contentLanguage);
    const saveInProgressRef = useRef(false);
    // Part of the query key, bumped by `resyncWithServer`, so that a response cached for a
    // previous session can never be mistaken for the current session's settings.
    const [sessionGeneration, setSessionGeneration] = useState(0);

    // Load settings from server on mount
    const {
        data: serverSettingsResponse,
        isSuccess: serverSettingsLoaded,
        isError: serverSettingsErrored,
        isPlaceholderData,
        error,
    } = useQuery({
        queryKey: ['user-settings', SETTINGS_STORE_KEY, sessionGeneration],
        queryFn: () => api.query(getSettingsStoreValueDocument, { key: SETTINGS_STORE_KEY }),
        retry: false,
        staleTime: 0,
        enabled: settingsStoreIsAvailable,
    });

    useEffect(() => {
        if (
            settingsStoreIsAvailable &&
            error?.message.includes('Settings store field not registered: vendure.dashboard.userSettings')
        ) {
            logSettingsStoreWarning();
            setSettingsStoreIsAvailable(false);
        }
    }, [settingsStoreIsAvailable, error]);

    // Mutation to save settings to server
    const saveToServerMutation = useMutation({
        mutationFn: (settingsToSave: UserSettings) =>
            api.mutate(setSettingsStoreValueDocument, {
                input: { key: SETTINGS_STORE_KEY, value: settingsToSave },
            }),
        onSuccess: (_, settingsSaved) => {
            // Only update serverSettings after successful save
            setServerSettings(settingsSaved);
            saveInProgressRef.current = false;
        },
        onError: error => {
            console.error('Failed to save user settings to server:', error);
            saveInProgressRef.current = false;
        },
    });

    // Initialize settings from server if available
    useEffect(() => {
        if (isReady) {
            return;
        }
        if (isPlaceholderData) {
            // The previous session's response, shown while the current one loads.
            return;
        }
        if (serverSettingsLoaded) {
            try {
                const serverSettingsData =
                    serverSettingsResponse?.getSettingsStoreValue as UserSettings | null;
                if (serverSettingsData) {
                    // Server has settings, use them
                    const mergedSettings = { ...defaultSettings, ...serverSettingsData };
                    setSettings(mergedSettings);
                    setServerSettings(mergedSettings);
                } else {
                    // Server has no settings, use local settings
                    setServerSettings(settings);
                }
            } catch (e) {
                console.error('Failed to parse server settings:', e);
                setServerSettings(settings);
            }
            setIsReady(true);
            setIsResolved(true);
        } else if (serverSettingsErrored) {
            // Fetch failed and won't retry (retry: false); fall back to local settings and mark
            // resolved so consumers gating on `settingsReady` don't hang forever. Do *not* start
            // saving to the server: the usual cause is that nobody is logged in yet (the provider
            // mounts on the login page, where the query is FORBIDDEN), and syncing then would
            // ignore the user's saved settings once they log in and overwrite them with the
            // local ones. The next successful fetch (after login) initializes from the server.
            setIsResolved(true);
        }
    }, [
        serverSettingsLoaded,
        serverSettingsErrored,
        serverSettingsResponse,
        isPlaceholderData,
        settings,
        isReady,
    ]);

    // Save settings to localStorage whenever they change
    useEffect(() => {
        try {
            localStorage.setItem(LS_KEY_USER_SETTINGS, JSON.stringify(settings));
        } catch (e) {
            console.error('Failed to save user settings to localStorage', e);
        }
    }, [settings]);

    // Save to server when settings differ from server state
    useEffect(() => {
        if (settingsStoreIsAvailable && isReady && serverSettings && !saveInProgressRef.current) {
            const serverDiffers = JSON.stringify(serverSettings) !== JSON.stringify(settings);

            if (serverDiffers) {
                saveInProgressRef.current = true;
                saveToServerMutation.mutate(settings);
                // Don't update serverSettings here - wait for mutation success
            }
        }
    }, [settings, serverSettings, isReady, saveToServerMutation]);

    // Invalidate all queries when content language changes
    useEffect(() => {
        if (queryClient && settings.contentLanguage !== previousContentLanguage.current) {
            void queryClient.invalidateQueries();
            previousContentLanguage.current = settings.contentLanguage;
        }
    }, [settings.contentLanguage, queryClient]);

    const resyncWithServer = useCallback(() => {
        setSessionGeneration(generation => generation + 1);
        setIsReady(false);
        setServerSettings(null);
    }, []);

    // Settings updaters
    const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const contextValue: UserSettingsContextType = {
        settingsStoreIsAvailable,
        settingsReady: isResolved || !settingsStoreIsAvailable,
        resyncWithServer,
        settings,
        setDisplayLanguage: language => updateSetting('displayLanguage', language),
        setDisplayLocale: locale => updateSetting('displayLocale', locale),
        setContentLanguage: language => updateSetting('contentLanguage', language),
        setTheme: theme => updateSetting('theme', theme),
        setDisplayUiExtensionPoints: display => updateSetting('displayUiExtensionPoints', display),
        setMainNavExpanded: expanded => updateSetting('mainNavExpanded', expanded),
        setActiveChannelId: channelId => updateSetting('activeChannelId', channelId),
        setDevMode: devMode => updateSetting('devMode', devMode),
        setHasSeenOnboarding: hasSeen => updateSetting('hasSeenOnboarding', hasSeen),
        setTableSettings: (tableId, key, value) => {
            setSettings(prev => ({
                ...prev,
                tableSettings: {
                    ...prev.tableSettings,
                    [tableId]: { ...(prev.tableSettings?.[tableId] || {}), [key]: value },
                },
            }));
        },
        setWidgetLayout: layoutConfig => updateSetting('widgetLayout', layoutConfig),
        saveWidgetInstanceLayouts: (layouts, loadedWidgetIds) => {
            setSettings(prev => {
                const loaded = new Set(loadedWidgetIds);
                const prevById = new Map(
                    (prev.widgetInstances ?? []).map(instance => [instance.instanceId, instance]),
                );
                // Instances for loaded widgets are fully replaced by `layouts`, so one removed
                // in the editor is dropped rather than resurrected on the next reload. Instances
                // for widgets not loaded (e.g. permission-filtered) are preserved untouched.
                const preserved = (prev.widgetInstances ?? []).filter(
                    instance => !loaded.has(instance.widgetId),
                );
                const merged = layouts.map(item => ({
                    instanceId: item.instanceId,
                    widgetId: item.widgetId,
                    layout: item.layout,
                    // Draft config is authoritative; fall back to the persisted config only
                    // when the caller supplies none (e.g. a never-saved instance).
                    config: item.config ?? prevById.get(item.instanceId)?.config,
                }));
                return { ...prev, widgetInstances: [...preserved, ...merged] };
            });
        },
        updateWidgetInstanceConfig: ({ instanceId, widgetId, layout, config }) => {
            setSettings(prev => {
                const instances = [...(prev.widgetInstances ?? [])];
                const index = instances.findIndex(instance => instance.instanceId === instanceId);
                if (index >= 0) {
                    // Preserve the existing layout; only the config changes here.
                    instances[index] = { ...instances[index], config };
                } else {
                    instances.push({ instanceId, widgetId, layout, config });
                }
                return { ...prev, widgetInstances: instances };
            });
        },
        setHiddenWidgets: widgetIds => updateSetting('hiddenWidgets', widgetIds),
    };

    return <UserSettingsContext.Provider value={contextValue}>{children}</UserSettingsContext.Provider>;
};

function logSettingsStoreWarning() {
    // eslint-disable-next-line no-console
    console.warn(
        [
            `User settings could not be fetched from the Vendure server.`,
            `This suggests that the DashboardPlugin is not configured.`,
            `Check your VendureConfig and ensure the DashboardPlugin is in your plugins array.`,
            ``,
            `By setting up the DashboardPlugin, you can take advantage of:`,
            ` - Persisted settings across browsers and devices`,
            ` - Saved views on list pages`,
            ` - Metrics on the Insights page`,
            ``,
            `https://docs.vendure.io/reference/core-plugins/dashboard-plugin/`,
        ].join('\n'),
    );
}
