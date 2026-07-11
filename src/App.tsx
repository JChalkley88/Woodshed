import { Route, Routes } from "react-router-dom";
import HardwarePage from "./pages/HardwarePage.tsx";
import LandingPage from "./pages/LandingPage.tsx";
import SpikePage from "./pages/SpikePage.tsx";
import StudioPage from "./pages/StudioPage.tsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/studio" element={<StudioPage />} />
      <Route path="/hardware" element={<HardwarePage />} />
      <Route path="/spike" element={<SpikePage />} />
    </Routes>
  );
}
