import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { ColumnFiltersState, SortingState, Table } from '@tanstack/react-table';
import React, { createContext, ReactNode } from 'react';

export type ColumnConfig = { columnOrder: string[]; columnVisibility: Record<string, boolean> };

interface DataTableContextValue {
    columnFilters: ColumnFiltersState;
    setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
    searchTerm: string;
    setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
    sorting: SortingState;
    setSorting: React.Dispatch<React.SetStateAction<SortingState>>;
    pageId?: string;
    onFilterChange?: (table: Table<any>, filters: ColumnFiltersState) => void;
    onSearchTermChange?: (searchTerm: string) => void;
    onRefresh?: () => void;
    isLoading?: boolean;
    table?: Table<any>;
    handleApplyView: (filters: ColumnFiltersState, columnConfig: ColumnConfig, searchTerm?: string) => void;
}

export const DataTableContext = createContext<DataTableContextValue | undefined>(undefined);

export interface DataTableProviderProps {
    children: ReactNode;
    columnFilters: ColumnFiltersState;
    setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>;
    searchTerm: string;
    setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
    sorting: SortingState;
    setSorting: React.Dispatch<React.SetStateAction<SortingState>>;
    pageId?: string;
    onFilterChange?: (table: Table<any>, filters: ColumnFiltersState) => void;
    onSearchTermChange?: (searchTerm: string) => void;
    onRefresh?: () => void;
    isLoading?: boolean;
    table?: Table<any>;
}

export function DataTableProvider({
    children,
    columnFilters,
    setColumnFilters,
    searchTerm,
    setSearchTerm,
    sorting,
    setSorting,
    pageId,
    onFilterChange,
    onSearchTermChange,
    onRefresh,
    isLoading,
    table,
}: DataTableProviderProps) {
    const { setTableSettings } = useUserSettings();

    const handleApplyView = (
        filters: ColumnFiltersState,
        columnConfig: ColumnConfig,
        viewSearchTerm?: string,
    ) => {
        setColumnFilters(filters);
        if (viewSearchTerm !== undefined && onSearchTermChange) {
            setSearchTerm(viewSearchTerm);
            onSearchTermChange(viewSearchTerm);
        }
        if (onFilterChange && table) {
            onFilterChange(table, filters);
        }

        // An empty column config means the view carries no column layout of its own, so the
        // user's existing layout is left alone. Writing the empty value would instead pin the
        // table to "no columns ordered", discarding the code and extension defaults.
        if (pageId && columnConfig?.columnOrder?.length) {
            setTableSettings(pageId, 'columnOrder', columnConfig.columnOrder);
        }
        if (pageId && Object.keys(columnConfig?.columnVisibility ?? {}).length) {
            setTableSettings(pageId, 'columnVisibility', columnConfig.columnVisibility);
        }
    };

    const value: DataTableContextValue = {
        columnFilters,
        setColumnFilters,
        searchTerm,
        setSearchTerm,
        sorting,
        setSorting,
        pageId,
        onFilterChange,
        onSearchTermChange,
        onRefresh,
        isLoading,
        table,
        handleApplyView,
    };

    return <DataTableContext.Provider value={value}>{children}</DataTableContext.Provider>;
}
