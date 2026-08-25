import type { HostMetrics, HostResourceSnapshotV1 } from "@/api/client.js";
import {
  formatAvailability,
  formatBatteryCapacity,
  formatBatteryPower,
  formatBatteryStatus,
} from "@/lib/host-resource-state.js";
import { formatCelsius } from "@/lib/host-metrics-format.js";

export type HostResourceGlanceMetric = {
  label: string;
  value: string;
  detail?: string;
  meterValue?: number;
  meterLabel?: string;
};

const ROW_CLASS =
  "min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2";
const HEADER_CLASS = "flex min-w-0 items-baseline justify-between gap-3";
const LABEL_CLASS =
  "min-w-0 [overflow-wrap:anywhere] text-[10px] font-bold uppercase tracking-widest text-[var(--color-text)]";
const VALUE_CLASS =
  "shrink-0 text-right text-[11px] font-bold text-[var(--color-primary)]";
const DETAIL_CLASS =
  "mt-1 min-w-0 [overflow-wrap:anywhere] text-[10px] text-[var(--color-text-muted)]";

export function MetricRow({
  label,
  value,
  detail,
  meterValue,
  meterLabel,
}: HostResourceGlanceMetric) {
  return (
    <div className={ROW_CLASS}>
      <div className={HEADER_CLASS}>
        <span className={LABEL_CLASS}>{label}</span>
        <span className={VALUE_CLASS}>{value}</span>
      </div>
      {meterValue !== undefined && meterLabel && (
        <meter
          className="mt-1.5 h-1.5 w-full accent-[var(--color-primary)]"
          min={0}
          max={100}
          value={meterValue}
          aria-label={meterLabel}
        />
      )}
      {detail && <p className={DETAIL_CLASS}>{detail}</p>}
    </div>
  );
}

export function TemperatureRows({
  temperatures,
}: {
  temperatures: HostMetrics["temperatures"];
}) {
  return (
    <section
      aria-label="Temperatures"
      className="space-y-2 border-t border-[var(--color-border)] pt-2.5"
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
        Temperatures
      </p>
      {temperatures.length === 0 ? (
        <p className="text-[10px] text-[var(--color-text-muted)]">
          Temperature sensors unavailable
        </p>
      ) : (
        <ul className="space-y-1.5" aria-label="Temperature sensors">
          {temperatures.map((temperature, index) => (
            <li key={`${temperature.source || "sensor"}-${index}`}>
              <MetricRow
                label={
                  temperature.label ||
                  temperature.source ||
                  `Sensor ${index + 1}`
                }
                value={formatCelsius(temperature.celsius)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function BatteryRow({
  battery,
}: {
  battery: HostResourceSnapshotV1["battery"];
}) {
  const hasTrustworthyReading =
    battery?.availability.state === "available" ||
    battery?.availability.state === "stale";
  const capacity =
    battery && hasTrustworthyReading
      ? formatBatteryCapacity(battery.capacityPercent)
      : undefined;
  const meterValue =
    battery && hasTrustworthyReading
      ? validBatteryPercent(battery.capacityPercent)
      : undefined;
  const status =
    battery && hasTrustworthyReading
      ? formatBatteryStatus(battery.status)
      : undefined;
  const power =
    battery && hasTrustworthyReading
      ? formatBatteryPower(battery.instantaneousPowerW)
      : undefined;
  const availability = battery
    ? formatAvailability(battery.availability)
    : "Battery telemetry unavailable";
  return (
    <section
      aria-label="Battery and power"
      className="border-t border-[var(--color-border)] pt-2.5"
    >
      <MetricRow
        label="Battery"
        value={capacity ?? "Unavailable"}
        detail={[status, power && `Power ${power}`, availability]
          .filter(Boolean)
          .join(" · ")}
        meterValue={meterValue}
        meterLabel="Battery charge percentage"
      />
    </section>
  );
}

function validBatteryPercent(
  value: number | null | undefined,
): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : undefined;
}
