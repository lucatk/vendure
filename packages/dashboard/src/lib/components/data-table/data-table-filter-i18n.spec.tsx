import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@/vdb/components/ui/dialog.js';
import { DataTableFilterBadge } from './data-table-filter-badge.js';
import { DataTableFilterDialog } from './data-table-filter-dialog.js';
import { DataTableEnumFilter } from './filters/data-table-enum-filter.js';

/**
 * The catalog the mocked lingui instance answers from. Mirrors what a real merged
 * catalog holds: a `fieldName.*` entry from a plugin .po, `enumValue.*` entries from
 * the dashboard's own de.po, plus one key that is present but untranslated.
 */
const messages: Record<string, string> = {
    'fieldName.activeWithdrawalRequest': 'Auszahlungsanforderung',
    'enumValue.OrderType.Regular': 'Regulär',
    'enumValue.OrderType.Seller': 'Verkäuferbestellung',
    // Present in the catalog but never translated — compiles to the id itself.
    'enumValue.OrderType.Aggregate': 'enumValue.OrderType.Aggregate',
};

// The `@lingui/react/macro` imports compile down to `useLingui` / `Trans` from
// `@lingui/react`, so mocking that one module covers both.
vi.mock('@lingui/react', () => {
    const resolve = (descriptor: any) => {
        if (typeof descriptor === 'string') {
            return messages[descriptor] ?? descriptor;
        }
        const id = descriptor?.id;
        return messages[id] ?? descriptor?.message ?? id ?? '';
    };
    const interpolate = (props: any) =>
        typeof props?.message === 'string'
            ? props.message.replace(/\{(\w+)\}/g, (_m: string, key: string) => props?.values?.[key] ?? '')
            : resolve(props);
    return {
        useLingui: () => ({
            i18n: {
                messages,
                t: (id: string) => messages[id] ?? id,
            },
            _: resolve,
            t: resolve,
        }),
        Trans: (props: any) => <>{messages[props?.id] ?? interpolate(props)}</>,
    };
});

vi.mock('@/vdb/hooks/use-local-format.js', () => ({
    useLocalFormat: () => ({
        formatDate: (value: string | Date) => String(value),
        formatCurrency: (value: number) => String(value),
    }),
}));

vi.mock('@/vdb/framework/document-introspection/get-document-structure.js', () => ({
    getEnumValues: (type: string) =>
        type === 'OrderType' ? ['Aggregate', 'Regular', 'Seller'] : undefined,
}));

/**
 * The filter dialog renders into a Base UI portal, which `renderToStaticMarkup` skips —
 * so it needs a real (jsdom) mount.
 */
async function mountDialog(columnId: string, fieldType: string, filterValue?: Record<string, any>) {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const column: any = {
        id: columnId,
        getFilterValue: () => filterValue,
        setFilterValue: () => undefined,
        columnDef: { meta: { fieldInfo: { type: fieldType } } },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(
            <Dialog open={true}>
                <DataTableFilterDialog column={column} />
            </Dialog>,
        );
    });
    const text = document.body.textContent ?? '';
    await act(async () => {
        root.unmount();
    });
    container.remove();
    return text;
}

describe('filter UI translations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('DataTableFilterBadge', () => {
        it('renders the translated field name, not the raw column id', () => {
            const html = renderToStaticMarkup(
                <DataTableFilterBadge
                    filter={{ id: 'activeWithdrawalRequest', value: { eq: true } }}
                    onRemove={() => undefined}
                    dataType={'Boolean' as any}
                    currencyCode="EUR"
                />,
            );
            expect(html).toContain('Auszahlungsanforderung');
            expect(html).not.toContain('activeWithdrawalRequest');
        });

        it('humanises a field name that has no catalog entry', () => {
            const html = renderToStaticMarkup(
                <DataTableFilterBadge
                    filter={{ id: 'someUnknownField', value: { eq: 'x' } }}
                    onRemove={() => undefined}
                    dataType={'String' as any}
                    currencyCode="EUR"
                />,
            );
            expect(html).toContain('Some Unknown Field');
        });

        it('renders the translated enum member as the filter value', () => {
            const html = renderToStaticMarkup(
                <DataTableFilterBadge
                    filter={{ id: 'type', value: { eq: 'Regular' } }}
                    onRemove={() => undefined}
                    dataType={'OrderType' as any}
                    currencyCode="EUR"
                />,
            );
            expect(html).toContain('Regulär');
            expect(html).not.toContain('>Regular<');
        });

        it('leaves a plain string value alone', () => {
            const html = renderToStaticMarkup(
                <DataTableFilterBadge
                    filter={{ id: 'code', value: { contains: 'Regular' } }}
                    onRemove={() => undefined}
                    dataType={'String' as any}
                    currencyCode="EUR"
                />,
            );
            expect(html).toContain('Regular');
        });
    });

    describe('DataTableEnumFilter', () => {
        it('labels the selected value with its translation', () => {
            const html = renderToStaticMarkup(
                <DataTableEnumFilter
                    value={{ eq: 'Seller' }}
                    options={['Aggregate', 'Regular', 'Seller']}
                    enumType="OrderType"
                    onChange={() => undefined}
                />,
            );
            expect(html).toContain('Verkäuferbestellung');
            expect(html).not.toContain('>Seller<');
        });

        it('falls back to the humanised value when the catalog entry is untranslated', () => {
            const html = renderToStaticMarkup(
                <DataTableEnumFilter
                    value={{ eq: 'Aggregate' }}
                    options={['Aggregate', 'Regular', 'Seller']}
                    enumType="OrderType"
                    onChange={() => undefined}
                />,
            );
            expect(html).toContain('Aggregate');
            expect(html).not.toContain('enumValue.OrderType.Aggregate');
        });
    });

    describe('DataTableFilterDialog', () => {
        it('titles the dialog with the translated field name', async () => {
            const text = await mountDialog('activeWithdrawalRequest', 'Boolean');
            expect(text).toContain('Filter by Auszahlungsanforderung');
            expect(text).not.toContain('activeWithdrawalRequest');
        });

        // Only the closed Select trigger is in the DOM, so this asserts on the selected
        // value's label — which is what the `enumType` prop feeds.
        it('passes the enum type down so the value is translated', async () => {
            const text = await mountDialog('type', 'OrderType', { eq: 'Seller' });
            expect(text).toContain('Verkäuferbestellung');
            expect(text).not.toContain('Seller order');
        });
    });
});
