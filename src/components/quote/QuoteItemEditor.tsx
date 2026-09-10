"use client";

import { useId } from "react";
import { useLocale } from "@/components/site/LocaleProvider";
import {
  Field,
  QuantityStepper,
  SegmentedControl,
  inputClass,
  inputErrorClass,
} from "@/components/quote/controls";
import type { DraftErrors, DraftItem } from "@/components/quote/item-model";
import type { DeliverySpeed, PreferenceType, ProductType } from "@/lib/types/quote-request";

/**
 * The expanded editor for the item currently being added or changed.
 *
 * Only one of these is open at a time — everything already added collapses
 * to a one-line summary, so a request with eight products doesn't become
 * eight permanently-open forms.
 */
export function QuoteItemEditor({
  item,
  errors,
  onChange,
  onCommit,
  onCancel,
  isEditing,
}: {
  item: DraftItem;
  errors: DraftErrors;
  onChange: (patch: Partial<DraftItem>) => void;
  onCommit: () => void;
  /** Only offered while editing an existing item — the first item can't be cancelled. */
  onCancel?: () => void;
  isEditing: boolean;
}) {
  const { copy } = useLocale();
  const id = useId();
  const isTyre = item.productType === "tyre";

  return (
    <div className="rounded-2xl border border-accent/30 bg-white p-4 shadow-sm sm:p-5">
      <div className="space-y-5">
        <SegmentedControl<ProductType>
          label={copy.productType}
          name={`${id}-type`}
          value={item.productType}
          onChange={(next) =>
            onChange({
              productType: next,
              // Quantity default follows the type unless the user already moved it.
              quantity: next === "tyre" ? Math.max(item.quantity, 2) : item.quantity,
            })
          }
          options={[
            { value: "tyre", label: copy.tyre },
            { value: "other", label: copy.otherProduct },
          ]}
        />

        {isTyre ? (
          <>
            <div>
              <div className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
                {copy.dimensions}
              </div>
              {/* The / and R separators are visible so the control reads as a
                  real tyre size, not three unrelated boxes. */}
              <div className="flex items-start gap-1.5">
                <div className="min-w-0 flex-1">
                  <input
                    id={`${id}-width`}
                    type="number"
                    inputMode="numeric"
                    placeholder="205"
                    aria-label={copy.width}
                    aria-invalid={errors.width ? true : undefined}
                    aria-describedby={errors.width ? `${id}-dims-error` : undefined}
                    value={item.width}
                    onChange={(event) => onChange({ width: event.target.value })}
                    className={`${errors.width ? inputErrorClass : inputClass} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
                  />
                </div>
                <span aria-hidden="true" className="pt-3 text-lg font-bold text-ink-soft">/</span>
                <div className="min-w-0 flex-1">
                  <input
                    id={`${id}-profile`}
                    type="number"
                    inputMode="numeric"
                    placeholder="55"
                    aria-label={copy.profile}
                    aria-invalid={errors.profile ? true : undefined}
                    aria-describedby={errors.profile ? `${id}-dims-error` : undefined}
                    value={item.profile}
                    onChange={(event) => onChange({ profile: event.target.value })}
                    className={`${errors.profile ? inputErrorClass : inputClass} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
                  />
                </div>
                <span aria-hidden="true" className="pt-3 text-lg font-bold text-ink-soft">R</span>
                <div className="min-w-0 flex-1">
                  <input
                    id={`${id}-rim`}
                    type="number"
                    inputMode="numeric"
                    placeholder="16"
                    aria-label={copy.rim}
                    aria-invalid={errors.rim ? true : undefined}
                    aria-describedby={errors.rim ? `${id}-dims-error` : undefined}
                    value={item.rim}
                    onChange={(event) => onChange({ rim: event.target.value })}
                    className={`${errors.rim ? inputErrorClass : inputClass} text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
                  />
                </div>
              </div>
              {(errors.width || errors.profile || errors.rim) && (
                <p id={`${id}-dims-error`} role="alert" className="mt-1 text-xs font-semibold text-state-danger">
                  {errors.width ?? errors.profile ?? errors.rim}
                </p>
              )}
            </div>

            <Field label={`${copy.loadSpeedIndex} · ${copy.optional}`} htmlFor={`${id}-index`}>
              <input
                id={`${id}-index`}
                type="text"
                placeholder={copy.loadSpeedPlaceholder}
                value={item.loadSpeedIndex}
                onChange={(event) => onChange({ loadSpeedIndex: event.target.value })}
                className={inputClass}
              />
            </Field>

            {/* Optional, and "Indifferente" is the default: forcing a season
                choice would make the customer guess at something the sales
                team can decide better. */}
            <Field label={`${copy.seasonLabel} · ${copy.optional}`} htmlFor={`${id}-season`}>
              <select
                id={`${id}-season`}
                value={item.season}
                onChange={(event) =>
                  onChange({ season: event.target.value as DraftItem["season"] })
                }
                className={inputClass}
              >
                <option value="">{copy.seasonAny}</option>
                <option value="summer">{copy.seasonSummer}</option>
                <option value="winter">{copy.seasonWinter}</option>
                <option value="all_season">{copy.seasonAllSeason}</option>
              </select>
            </Field>
          </>
        ) : (
          <Field
            label={copy.productDescription}
            htmlFor={`${id}-description`}
            error={errors.description}
          >
            <input
              id={`${id}-description`}
              type="text"
              placeholder={copy.productDescriptionPlaceholder}
              aria-invalid={errors.description ? true : undefined}
              aria-describedby={errors.description ? `${id}-description-error` : undefined}
              value={item.description}
              onChange={(event) => onChange({ description: event.target.value })}
              className={errors.description ? inputErrorClass : inputClass}
            />
          </Field>
        )}

        <QuantityStepper
          label={copy.quantity}
          value={item.quantity}
          onChange={(quantity) => onChange({ quantity })}
          decreaseLabel={copy.decrease}
          increaseLabel={copy.increase}
        />

        <SegmentedControl<PreferenceType>
          label={copy.preference}
          name={`${id}-preference`}
          value={item.preferenceType}
          onChange={(preferenceType) => onChange({ preferenceType })}
          options={[
            { value: "best_price", label: copy.bestPrice },
            { value: "specific_brand", label: copy.specificBrand },
          ]}
        />

        {item.preferenceType === "specific_brand" && (
          <Field label={copy.brand} htmlFor={`${id}-brand`} error={errors.preferredBrand}>
            <input
              id={`${id}-brand`}
              type="text"
              placeholder={copy.brandPlaceholder}
              aria-invalid={errors.preferredBrand ? true : undefined}
              aria-describedby={errors.preferredBrand ? `${id}-brand-error` : undefined}
              value={item.preferredBrand}
              onChange={(event) => onChange({ preferredBrand: event.target.value })}
              className={errors.preferredBrand ? inputErrorClass : inputClass}
            />
          </Field>
        )}

        <SegmentedControl<DeliverySpeed>
          label={copy.whenNeeded}
          name={`${id}-delivery`}
          value={item.deliverySpeed}
          onChange={(deliverySpeed) => onChange({ deliverySpeed })}
          error={errors.deliverySpeed}
          options={[
            { value: "48h", label: copy.within48h },
            { value: "7d", label: copy.within7d },
          ]}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCommit}
          className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-accent px-6 text-base font-bold text-white transition-colors hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 sm:flex-none"
        >
          {isEditing ? copy.edit : copy.add}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-ink/15 px-5 text-sm font-semibold text-ink-soft transition-colors hover:border-ink/30 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {copy.cancel}
          </button>
        )}
      </div>
    </div>
  );
}
