import { camelCaseToTitleCase } from '@/vdb/lib/utils.js';
import { useLingui } from '@lingui/react';

export function useDynamicTranslations() {
    const { i18n } = useLingui();

    // Calling i18n.t() for an id missing from the catalog logs a
    // "Uncompiled message detected!" warning in production builds. The catalog
    // does not include every possible custom-field name or state name, so guard
    // the lookup instead of relying on i18n.t() returning the raw id.
    // A key that is present but untranslated compiles to the id itself, which
    // would print e.g. "enumValue.OrderType.Regular" — treat that as a miss too.
    const translateOrFallback = (id: string, fallback: () => string) => {
        if (!(id in i18n.messages)) {
            return fallback();
        }
        const translated = i18n.t(id);
        return !translated || translated === id ? fallback() : translated;
    };

    const getTranslatedFieldName = (fieldId: string) =>
        translateOrFallback(`fieldName.${fieldId}`, () => camelCaseToTitleCase(fieldId));

    const getTranslatedOrderState = (state: string) =>
        translateOrFallback(`orderState.${state}`, () => camelCaseToTitleCase(state));

    const getTranslatedFulfillmentState = (state: string) =>
        translateOrFallback(`fulfillmentState.${state}`, () => camelCaseToTitleCase(state));

    const getTranslatedPaymentState = (state: string) =>
        translateOrFallback(`paymentState.${state}`, () => camelCaseToTitleCase(state));

    const getTranslatedRefundState = (state: string) =>
        translateOrFallback(`refundState.${state}`, () => camelCaseToTitleCase(state));

    const getTranslatedRefundReason = (reason: string) =>
        translateOrFallback(`refundReason.${reason}`, () => camelCaseToTitleCase(reason));

    /**
     * Translates a GraphQL enum member, e.g. `OrderType` / `Regular`. The catalog key is
     * `enumValue.<EnumTypeName>.<value>`, so a plugin can supply labels for its own enums
     * from its own .po file without touching the dashboard catalog.
     */
    const getTranslatedEnumValue = (enumType: string | undefined, value: string) =>
        enumType
            ? translateOrFallback(`enumValue.${enumType}.${value}`, () => camelCaseToTitleCase(value))
            : camelCaseToTitleCase(value);

    return {
        getTranslatedFieldName,
        getTranslatedEnumValue,
        getTranslatedOrderState,
        getTranslatedFulfillmentState,
        getTranslatedPaymentState,
        getTranslatedRefundState,
        getTranslatedRefundReason,
    };
}
