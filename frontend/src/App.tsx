import { Routes, Route, NavLink, Link, Outlet, useLocation } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import ErrorBoundary from "./components/ErrorBoundary";
import { WrongNetworkBanner } from "./components/WrongNetworkBanner";
import { Wordmark } from "./components/ui";
import { Droplets, LayoutGrid, PlusCircle } from "lucide-react";
import LandingPage from "./pages/LandingPage";
import DocsPage from "./pages/DocsPage";
import AppDashboard from "./pages/AppDashboard";
import CreatePool from "./pages/CreatePool";
import PoolDashboard from "./pages/PoolDashboard";
import BorrowRequest from "./pages/BorrowRequest";
import VotePage from "./pages/VotePage";
import RepayPage from "./pages/RepayPage";

const FAUCET_URL = "https://faucet.circle.com";

function navCls({ isActive }: { isActive: boolean }) {
  return `inline-flex items-center gap-1.5 text-sm font-medium transition-colors ${
    isActive ? "text-navy" : "text-muted hover:text-navy"
  }`;
}

/** Shared shell for all /app/* routes: app header + wallet button. */
function AppLayout() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-white text-ink">
      <header className="sticky top-0 z-40 border-b border-hairline bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link to="/" aria-label="PoolPay home">
              <Wordmark />
            </Link>
            <nav className="hidden items-center gap-6 sm:flex">
              <NavLink to="/app" end className={navCls}>
                <LayoutGrid className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
                My Pools
              </NavLink>
              <NavLink to="/app/create" className={navCls}>
                <PlusCircle className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
                Create Pool
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <a
              href={FAUCET_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-navy sm:inline-flex"
            >
              <Droplets className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
              Faucet
            </a>
            <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
          </div>
        </div>
        {/* Mobile nav row ,the desktop links collapse here below the bar. */}
        <nav className="flex items-center gap-6 border-t border-hairline px-6 py-2.5 sm:hidden">
          <NavLink to="/app" end className={navCls}>
            <LayoutGrid className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            My Pools
          </NavLink>
          <NavLink to="/app/create" className={navCls}>
            <PlusCircle className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            Create Pool
          </NavLink>
          <a
            href={FAUCET_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-navy"
          >
            <Droplets className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            Faucet
          </a>
        </nav>
      </header>
      {/* Shown on every /app route; writes are blocked in useTx regardless. */}
      <WrongNetworkBanner />
      <main>
        {/* Keyed on the path so a crash on one page clears when you navigate away. */}
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/app" element={<AppLayout />}>
        <Route index element={<AppDashboard />} />
        <Route path="create" element={<CreatePool />} />
        <Route path="pool/:poolId" element={<PoolDashboard />} />
        <Route path="pool/:poolId/borrow" element={<BorrowRequest />} />
        <Route path="pool/:poolId/vote/:requestId" element={<VotePage />} />
        <Route path="pool/:poolId/repay" element={<RepayPage />} />
      </Route>
    </Routes>
  );
}
