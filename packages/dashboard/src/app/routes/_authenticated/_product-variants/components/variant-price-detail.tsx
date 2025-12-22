import { Money } from '@/vdb/components/data-display/money.js';
import { Field, FieldLabel } from '@/vdb/components/ui/field.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

const taxRatesDocument = graphql(`
    query TaxRates($options: TaxRateListOptions) {
        taxRates(options: $options) {
            items {
                id
                value
                zone {
                    id
                }
                category {
                    id
                }
            }
        }
    }
`);

interface VariantPriceDetailProps {
    priceIncludesTax: boolean;
    price: number | undefined;
    currencyCode: string;
    taxCategoryId: string | undefined;
}

export function VariantPriceDetail({
    priceIncludesTax,
    price,
    currencyCode,
    taxCategoryId,
}: VariantPriceDetailProps) {
    const { activeChannel } = useChannel();
    const [taxRate, setTaxRate] = useState(0);
    const [calculatedPrice, setCalculatedPrice] = useState(0);

    // Fetch tax rates
    const { data: taxRatesData } = useQuery({
        queryKey: ['taxRates'],
        queryFn: () => api.query(taxRatesDocument, { options: { take: 999, skip: 0 } }),
    });

    useEffect(() => {
        if (!taxRatesData?.taxRates.items || !activeChannel) {
            return;
        }

        const defaultTaxZone = activeChannel.defaultTaxZone?.id;
        if (!defaultTaxZone) {
            setTaxRate(0);
            return;
        }

        const applicableRate = taxRatesData.taxRates.items.find(
            taxRate => taxRate.zone.id === defaultTaxZone && taxRate.category.id === taxCategoryId,
        );

        if (!applicableRate) {
            setTaxRate(0);
            return;
        }

        setTaxRate(applicableRate.value);
    }, [taxRatesData, activeChannel, taxCategoryId]);

    // The price field holds gross when the channel's prices include tax, so the figure worth
    // showing beside it is the net one. Upstream shows "Gross price: <the number you just
    // typed>", which tells the user nothing.
    useEffect(() => {
        setCalculatedPrice(
            priceIncludesTax
                ? Math.round((price ?? 0) * (100 / (100 + taxRate)))
                : Math.round((price ?? 0) * ((100 + taxRate) / 100)),
        );
    }, [price, taxRate, priceIncludesTax]);

    return (
        <Field>
            <FieldLabel>
                {priceIncludesTax ? <Trans>Net price</Trans> : <Trans>Gross price</Trans>}{' '}
                <span className="text-muted-foreground">
                    {priceIncludesTax ? (
                        <Trans>(excl. {taxRate}% tax)</Trans>
                    ) : (
                        <Trans>(incl. {taxRate}% tax)</Trans>
                    )}
                </span>
            </FieldLabel>
            <div className="text-sm pt-1.5">
                <Money value={calculatedPrice} currency={currencyCode} />
            </div>
        </Field>
    );
}
