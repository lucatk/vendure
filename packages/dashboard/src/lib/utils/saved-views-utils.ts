import { ColumnFiltersState } from '@tanstack/react-table';

import { SavedView } from '../types/saved-views.js';

/**
 * Checks if the current filters and search term match any of the provided saved views
 * @param currentFilters - The current column filters
 * @param currentSearchTerm - The current search term
 * @param views - Array of saved views to check against
 * @returns The matching saved view if found, undefined otherwise
 */
export function findMatchingSavedView(
    currentFilters: ColumnFiltersState,
    currentSearchTerm: string,
    views: SavedView[],
): SavedView | undefined {
    return views.find(view => {
        const filtersMatch = JSON.stringify(view.filters) === JSON.stringify(currentFilters);
        const searchMatch = (view.searchTerm || '') === currentSearchTerm;
        return filtersMatch && searchMatch;
    });
}

/**
 * Sets or clears the `isDefault` flag on one view within a scope, enforcing that at most
 * one view in that scope is the default. Views whose flag does not change are returned
 * unchanged, so `updatedAt` only moves on the views that were actually modified.
 * @param views - All views of a single scope
 * @param viewId - The view to set or clear the flag on
 * @param isDefault - The new value of the flag
 * @returns A new array of views with the flag applied
 */
export function markDefaultSavedView(
    views: SavedView[],
    viewId: string,
    isDefault: boolean,
): SavedView[] {
    const now = new Date().toISOString();
    return views.map(view => {
        if (view.id === viewId) {
            return (view.isDefault ?? false) === isDefault ? view : { ...view, isDefault, updatedAt: now };
        }
        if (isDefault && view.isDefault) {
            // Only one view per scope may be the default.
            return { ...view, isDefault: false, updatedAt: now };
        }
        return view;
    });
}

/**
 * Returns the view that should be applied automatically when a table is opened. A personal
 * default takes precedence over the global one, so a user can override the shop-wide default.
 * @param userViews - Array of user saved views
 * @param globalViews - Array of global saved views
 * @returns The default view if one is set, undefined otherwise
 */
export function findDefaultSavedView(
    userViews: SavedView[],
    globalViews: SavedView[],
): SavedView | undefined {
    return userViews.find(view => view.isDefault) ?? globalViews.find(view => view.isDefault);
}

/**
 * Checks if the current filters match any saved view (user or global)
 * @param currentFilters - The current column filters
 * @param currentSearchTerm - The current search term
 * @param userViews - Array of user saved views
 * @param globalViews - Array of global saved views
 * @returns true if a matching view is found, false otherwise
 */
export function isMatchingSavedView(
    currentFilters: ColumnFiltersState,
    currentSearchTerm: string,
    userViews: SavedView[],
    globalViews: SavedView[],
): boolean {
    const allViews = [...userViews, ...globalViews];
    return findMatchingSavedView(currentFilters, currentSearchTerm, allViews) !== undefined;
}
