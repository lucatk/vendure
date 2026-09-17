import { describe, expect, it } from 'vitest';

import { SavedView } from '../types/saved-views.js';

import { findDefaultSavedView, markDefaultSavedView } from './saved-views-utils.js';

function view(id: string, scope: 'user' | 'global', isDefault?: boolean): SavedView {
    return {
        id,
        name: id,
        scope,
        filters: [],
        columnConfig: { columnOrder: [], columnVisibility: {} },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        ...(isDefault === undefined ? {} : { isDefault }),
    };
}

describe('markDefaultSavedView', () => {
    it('sets the flag on the named view', () => {
        const result = markDefaultSavedView([view('a', 'user'), view('b', 'user')], 'a', true);
        expect(result.map(v => v.isDefault)).toEqual([true, undefined]);
    });

    it('clears the flag from the previous default', () => {
        const result = markDefaultSavedView([view('a', 'user', true), view('b', 'user')], 'b', true);
        expect(result.map(v => v.isDefault)).toEqual([false, true]);
    });

    it('clears the flag without promoting another view', () => {
        const result = markDefaultSavedView([view('a', 'user', true), view('b', 'user')], 'a', false);
        expect(result.map(v => v.isDefault)).toEqual([false, undefined]);
    });

    it('leaves untouched views identical, including updatedAt', () => {
        const views = [view('a', 'user', true), view('b', 'user')];
        const result = markDefaultSavedView(views, 'a', true);
        expect(result[0]).toBe(views[0]);
        expect(result[1]).toBe(views[1]);
    });

    it('bumps updatedAt on every view it changes', () => {
        const views = [view('a', 'user', true), view('b', 'user')];
        const result = markDefaultSavedView(views, 'b', true);
        expect(result[0].updatedAt).not.toBe(views[0].updatedAt);
        expect(result[1].updatedAt).not.toBe(views[1].updatedAt);
    });

    it('is a no-op for an unknown view id', () => {
        const views = [view('a', 'user'), view('b', 'user')];
        expect(markDefaultSavedView(views, 'missing', true)).toEqual(views);
    });
});

describe('findDefaultSavedView', () => {
    it('returns undefined when no view is marked', () => {
        expect(findDefaultSavedView([view('a', 'user')], [view('g', 'global')])).toBeUndefined();
    });

    it('returns the global default when the user has none', () => {
        const globalDefault = view('g', 'global', true);
        expect(findDefaultSavedView([view('a', 'user')], [globalDefault])).toBe(globalDefault);
    });

    it('prefers the user default over the global one', () => {
        const userDefault = view('a', 'user', true);
        expect(findDefaultSavedView([userDefault], [view('g', 'global', true)])).toBe(userDefault);
    });
});
