import { useState } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { TelemetryProvider } from "./hooks/useWebSocket";
import { Sidebar } from "./components/Sidebar";
import { Header, SimulatedBanner } from "./components/Header";
import Overview from "./pages/Overview";
import LiveMonitoring from "./pages/LiveMonitoring";
import DataAcquisition from "./pages/DataAcquisition";
import SignalAnalysis from "./pages/SignalAnalysis";
import MLAnalytics from "./pages/MLAnalytics";
import SessionHistory from "./pages/SessionHistory";
import SettingsPage from "./pages/Settings";

const PAGES: Record<string, { title: string; subtitle: string }> = {
  "/": { title: "Overview", subtitle: "System health, detection state and recent activity" },
  "/live": { title: "Live Monitoring", subtitle: "Real-time MPU6050 and sEMG signals, detection gates and servo state" },
  "/acquisition": { title: "Data Acquisition", subtitle: "Record labelled datasets for machine-learning development" },
  "/analysis": { title: "Signal Analysis", subtitle: "Butterworth filtering, FFT spectrum and session comparison" },
  "/ml": { title: "ML Analytics", subtitle: "Model performance and live predictions" },
  "/sessions": { title: "Session History", subtitle: "Review and download previous recordings" },
  "/settings": { title: "Settings", subtitle: "Serial link, detection parameters and safety limits" },
};

function Shell() {
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  const page = PAGES[pathname] ?? PAGES["/"];
  return (
    <div className="min-h-full">
      <Sidebar open={menu} onClose={() => setMenu(false)} />
      <div className="flex min-h-screen flex-col lg:pl-64">
        <Header title={page.title} subtitle={page.subtitle} onMenu={() => setMenu(true)} />
        <SimulatedBanner />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/live" element={<LiveMonitoring />} />
            <Route path="/acquisition" element={<DataAcquisition />} />
            <Route path="/analysis" element={<SignalAnalysis />} />
            <Route path="/ml" element={<MLAnalytics />} />
            <Route path="/sessions" element={<SessionHistory />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Overview />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <TelemetryProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </TelemetryProvider>
  );
}
