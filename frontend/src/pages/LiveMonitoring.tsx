import { Activity, Compass, Move3d, Waves, Zap } from "lucide-react";
import { useNow, useWebSocket, useWindow } from "../hooks/useWebSocket";
import { DetectionPipeline } from "../components/DetectionPipeline";
import { ServoMonitor } from "../components/ServoMonitor";
import { SensorChart, SERIES, toRows } from "../components/SensorChart";
import { Badge, Card, EmptyState } from "../components/ui";
import { StatusIndicator } from "../components/StatusIndicator";

export default function LiveMonitoring() {
  const t = useWebSocket();
  const now = useNow(250);
  const set = t.settings;
  const fs = set?.fs ?? 100;
  const windowS = set?.graph_window_s ?? 8;
  const samples = useWindow(windowS, 800);
  const multi = useWindow(windowS, 500);
  const s = t.status;
  const gyro = !!s?.source.gyro_available;

  const emgRows = toRows(samples, fs, (x) => ({ raw: x.sensors.emg, avg: x.processing.emg_avg }));
  const accRows = toRows(multi, fs, (x) => ({ ax: x.sensors.ax, ay: x.sensors.ay, az: x.sensors.az }));
  const gyroRows = gyro ? toRows(multi, fs, (x) => ({ gx: x.sensors.gx, gy: x.sensors.gy, gz: x.sensors.gz })) : [];
  const magRows = toRows(samples, fs, (x) => ({ mag: x.sensors.magnitude }));
  const azRows = toRows(samples, fs, (x) => ({ az: x.sensors.az }));
  const filtRows = toRows(samples, fs, (x) => ({ f: x.processing.filtered_az }));

  const state = t.link === "closed" ? "BACKEND OFFLINE" : s?.system.state ?? "DISCONNECTED";
  const stale = s && s.source.state === "connected" && (s.source.last_sample_age ?? 0) > 1;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <StatusIndicator state={state} detail={t.link === "closed" ? "Backend offline" : s?.system.detail} />
        <DetectionPipeline status={s} settings={set} />
      </div>

      {stale && (
        <div className="rounded-lg border border-warn/40 bg-warn/[0.08] px-4 py-2.5 text-[13px] text-warn">
          No samples for {s?.source.last_sample_age?.toFixed(1)} s. The charts below show the last data received, not the current hand state.
        </div>
      )}

      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="space-y-6 2xl:col-span-2">
          <Card
            title="sEMG signal"
            subtitle={`Raw ADC (0–4095) and ${set?.emg_avg_samples ?? 10}-sample moving average used by the detector`}
            icon={Zap}
            actions={
              <Badge tone={s?.detection.emg_active ? "teal" : "neutral"}>EMG {s?.detection.emg_active ? "active" : "inactive"}</Badge>
            }
          >
            <SensorChart
              rows={emgRows}
              series={[
                { key: "raw", label: "Raw sEMG", color: SERIES.s1, width: 1.25 },
                { key: "avg", label: "Moving avg", color: SERIES.s2, width: 2.25 },
              ]}
              refLines={[
                { y: set?.emg_threshold_high ?? 1500, label: `High ${set?.emg_threshold_high ?? 1500}` },
                { y: set?.emg_threshold_low ?? 500, label: `Low ${set?.emg_threshold_low ?? 500}` },
              ]}
              yDomain={[0, 4095]}
              windowSeconds={windowS}
              height={230}
              format={(v) => v.toFixed(0)}
            />
          </Card>

          <Card
            title="Accelerometer"
            subtitle="X, Y, Z in g. Z is the axis the tremor detector analyses."
            icon={Move3d}
            actions={<Badge tone="teal" icon={null}>Z = detection axis</Badge>}
          >
            <SensorChart
              rows={accRows}
              series={[
                { key: "ax", label: "AX", color: SERIES.s1, width: 1.25 },
                { key: "ay", label: "AY", color: SERIES.s2, width: 1.25 },
                { key: "az", label: "AZ (detection)", color: SERIES.s3, width: 2.5 },
              ]}
              yDomain={[(min: number) => Math.min(-0.2, Math.floor(min * 10) / 10), (max: number) => Math.max(1.2, Math.ceil(max * 10) / 10)]}
              windowSeconds={windowS}
              height={220}
              yTickFormat={(v) => v.toFixed(1)}
            />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Raw Z-axis" subtitle="Accelerometer Z before filtering (g)" icon={Activity}>
              <SensorChart
                rows={azRows}
                series={[{ key: "az", label: "AZ raw", color: SERIES.s1, width: 1.5 }]}
                windowSeconds={windowS}
                height={170}
                showLegend={false}
                yTickFormat={(v) => v.toFixed(2)}
              />
            </Card>
            <Card
              title="Filtered Z-axis"
              subtitle={`Butterworth bandpass ${set?.lowcut ?? 4}–${set?.highcut ?? 12} Hz, order ${set?.filter_order ?? 2} (g)`}
              icon={Waves}
            >
              <SensorChart
                rows={filtRows}
                series={[{ key: "f", label: "AZ filtered", color: SERIES.s3, width: 1.75 }]}
                windowSeconds={windowS}
                height={170}
                showLegend={false}
                yDomain={[(min: number) => Math.min(-0.05, min), (max: number) => Math.max(0.05, max)]}
                yTickFormat={(v) => v.toFixed(2)}
              />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Gyroscope" subtitle="Angular rate X, Y, Z (°/s)" icon={Compass}>
              {gyro ? (
                <SensorChart
                  rows={gyroRows}
                  series={[
                    { key: "gx", label: "GX", color: SERIES.s1, width: 1.25 },
                    { key: "gy", label: "GY", color: SERIES.s2, width: 1.25 },
                    { key: "gz", label: "GZ", color: SERIES.s3, width: 1.25 },
                  ]}
                  windowSeconds={windowS}
                  height={170}
                  format={(v) => v.toFixed(1)}
                  yTickFormat={(v) => v.toFixed(0)}
                />
              ) : (
                <EmptyState icon={Compass} title="Gyroscope not streamed" className="!py-6">
                  The current firmware sends <code className="text-ink-2">EMG,AX,AY,AZ,MAG</code> only. Flash{" "}
                  <code className="text-ink-2">firmware/esp32_code/esp32_code.ino</code> with <code className="text-ink-2">SEND_GYRO</code> enabled to add GX, GY, GZ.
                </EmptyState>
              )}
            </Card>
            <Card title="Movement magnitude" subtitle="√(AX² + AY² + AZ²) in g, about 1 g at rest" icon={Activity}>
              <SensorChart
                rows={magRows}
                series={[{ key: "mag", label: "Magnitude", color: SERIES.s1, width: 1.5 }]}
                windowSeconds={windowS}
                height={170}
                showLegend={false}
                yDomain={[(min: number) => Math.min(0.8, Math.floor(min * 10) / 10), (max: number) => Math.max(1.2, Math.ceil(max * 10) / 10)]}
                yTickFormat={(v) => v.toFixed(1)}
              />
            </Card>
          </div>
        </div>

        <div className="space-y-6">
          <ServoMonitor servo={s?.servo ?? null} now={s?.server_time ?? now} />
        </div>
      </div>
    </div>
  );
}
