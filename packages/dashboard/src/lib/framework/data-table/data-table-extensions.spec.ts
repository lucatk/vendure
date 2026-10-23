import { describe, expect, it } from 'vitest';

import { addViewOptionDefaults, getViewOptionDefaults } from './data-table-extensions.js';

describe('view option defaults: sorting', () => {
    it('is undefined when no extension registers one', () => {
        addViewOptionDefaults('sorting-spec-none', undefined, { columnVisibility: { name: true } });

        expect(getViewOptionDefaults('sorting-spec-none').sorting).toBeUndefined();
    });

    it('is kept when a later extension registers only other defaults', () => {
        addViewOptionDefaults('sorting-spec-kept', undefined, {
            sorting: [{ id: 'displayOrder', desc: false }],
        });
        addViewOptionDefaults('sorting-spec-kept', undefined, { columnVisibility: { name: true } });

        expect(getViewOptionDefaults('sorting-spec-kept').sorting).toEqual([
            { id: 'displayOrder', desc: false },
        ]);
    });

    it('is replaced as a whole by the last extension to register one', () => {
        addViewOptionDefaults('sorting-spec-last', undefined, {
            sorting: [
                { id: 'displayOrder', desc: false },
                { id: 'name', desc: false },
            ],
        });
        addViewOptionDefaults('sorting-spec-last', undefined, { sorting: [{ id: 'updatedAt', desc: true }] });

        expect(getViewOptionDefaults('sorting-spec-last').sorting).toEqual([{ id: 'updatedAt', desc: true }]);
    });

    it('is registered per block', () => {
        addViewOptionDefaults('sorting-spec-block', 'product-options', {
            sorting: [{ id: 'displayOrder', desc: false }],
        });

        expect(getViewOptionDefaults('sorting-spec-block').sorting).toBeUndefined();
        expect(getViewOptionDefaults('sorting-spec-block', 'product-options').sorting).toEqual([
            { id: 'displayOrder', desc: false },
        ]);
    });
});
