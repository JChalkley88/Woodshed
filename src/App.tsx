import { Route, Routes } from "react-router-dom";
import HardwarePage from "./pages/HardwarePage.tsx";
import SpikePage from "./pages/SpikePage.tsx";
import StudioPage from "./pages/StudioPage.tsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StudioPage />} />
      <Route path="/hardware" element={<HardwarePage />} />
      <Route path="/spike" element={<SpikePage />} />
    </Routes>
  );
}
