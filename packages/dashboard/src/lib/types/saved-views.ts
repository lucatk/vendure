import { ColumnFiltersState } from '@tanstack/react-table';

import { ColumnConfig } from '../components/data-table/data-table-context.js';

export interface SavedView {
    id: string;
    name: string;
    scope: 'user' | 'global';
    filters: ColumnFiltersState;
    columnConfig: ColumnConfig;
    searchTerm?: string;
    pageId?: string;
    blockId?: string;
    createdAt: string; // ISO timestamp string
    updatedAt: string; // ISO timestamp string
    createdBy?: string;
    /**
     * When true, this view is applied automatically when the table is opened with no
     * active filters. At most one view per scope may be the default; a personal default
     * takes precedence over the global one.
     */
    isDefault?: boolean;
}

export interface SavedViewsData {
    userViews: SavedView[];
    globalViews: SavedView[];
}

export interface SavedViewsStore {
    [pageId: string]: {
        [blockId: string]: SavedView[];
    };
}

export interface SaveViewInput {
    name: string;
    scope: 'user' | 'global';
    filters: ColumnFiltersState;
    columnConfig: ColumnConfig;
    searchTerm?: string;
    isDefault?: boolean;
}

export interface UpdateViewInput {
    id: string;
    name?: string;
    filters?: ColumnFiltersState;
    searchTerm?: string;
    isDefault?: boolean;
}
