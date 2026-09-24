/**
 * Who holds the property, as the surveyor recorded it on site.
 *
 * Since 2026-09-24 the complaint form no longer asks for the owner, property
 * type, floors or police station; the field app records them on the round. This
 * panel shows the newest round that recorded any of them, and nothing at all
 * when no round has.
 */

import { useQuery } from "@tanstack/react-query";
import { listCodeValues, type CodeValue } from "@/api/icms/reference";
import { useFormats, useLanguage } from "@/i18n";
import type { ComplaintDetailLabels } from "./ComplaintDetailLabels";
import { surveyedRound, telHref, type CaseRound } from "./ComplaintDetailModel";
import { Absent, DetailPanel, Field, Mono } from "./ComplaintDetailParts";

const PROPERTY_TYPE_DOMAIN = "property_type";

// The property type's label in the active language; the code itself for a retired value.
function usePropertyTypeLabel(code: string | null | undefined): string | null {
  const { language } = useLanguage();
  const { data } = useQuery<CodeValue[], Error>({
    queryKey: ["icms", "code-values", PROPERTY_TYPE_DOMAIN],
    queryFn: ({ signal }) => listCodeValues(PROPERTY_TYPE_DOMAIN, signal),
    enabled: Boolean(code),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  if (!code) return null;
  const row = data?.find((value) => value.code === code);
  if (row === undefined) return code;
  return language.startsWith("hi") && row.label_hi ? row.label_hi : row.label;
}

export function ComplaintDetailSurvey({
  rounds,
  labels,
  notRecorded,
}: {
  rounds: readonly CaseRound[];
  labels: ComplaintDetailLabels;
  notRecorded: string;
}) {
  const round = surveyedRound(rounds);
  const propertyType = usePropertyTypeLabel(round?.property_type_cd);
  const { number } = useFormats();
  if (round === null) return null;

  const absent = <Absent>{notRecorded}</Absent>;
  const phone = round.occupant_phone ?? null;
  const href = telHref(phone);

  return (
    <DetailPanel title={labels.panels.survey} description={labels.values.surveyRound(round.round_no)}>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Field label={labels.fields.owner_name}>{round.occupant_name ?? absent}</Field>
        <Field label={labels.fields.owner_phone}>
          {!phone ? (
            absent
          ) : href === null ? (
            <Mono>{phone}</Mono>
          ) : (
            <a
              href={href}
              className="rounded-xs font-mono text-xs text-fg-link underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {phone}
            </a>
          )}
        </Field>
        <Field label={labels.fields.property_type_cd}>{propertyType ?? absent}</Field>
        <Field label={labels.fields.floor_count}>
          {round.floor_count === null || round.floor_count === undefined
            ? absent
            : number(round.floor_count)}
        </Field>
        <Field label={labels.fields.police_station}>{round.police_station ?? absent}</Field>
      </dl>
    </DetailPanel>
  );
}
