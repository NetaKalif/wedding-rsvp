import React, { useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";
import PrivacyPolicy from "./components/global/PrivacyPolicy";
import TermsOfService from "./components/global/TermsOfService";
import "./App.css";
import { RSVPDashboard } from "./components/rsvp/RSVPDashboard";
import { WeddingDashboard } from "./components/userDashboard/WeddingDashboard";
import { TasksDashboard } from "./components/tasks/TasksDashboard";
import { BudgetDashboard } from "./components/budgetAndVendors/BudgetDashboard";
import WelcomePage from "./components/welcomePage/WelcomePage";
import { useAuth, AuthProvider } from "./hooks/useAuth";
import { AppDataProvider, useAppData } from "./hooks/useAppData";
import { Loader } from "@wix/design-system";

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function AppContent() {
  const { user, isLoading: authLoading } = useAuth();
  const { isDataLoading } = useAppData();

  if (authLoading || isDataLoading) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: "16px",
      }}>
        <Loader size="medium" />
      </div>
    );
  }

  return (
    <div className="App">
      <ScrollToTop />
      <main className="App-content">
        <Routes>
          <Route
            path="/"
            element={user ? <WeddingDashboard /> : <WelcomePage />}
          />
          <Route path="/rsvp" element={<RSVPDashboard />} />
          <Route path="/tasks" element={<TasksDashboard />} />
          <Route path="/budget" element={<BudgetDashboard />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms-of-service" element={<TermsOfService />} />
        </Routes>
      </main>

      <footer className="App-footer">
        <div className="footer-links">
          <Link to="/privacy-policy">Privacy Policy</Link>
          <span className="footer-divider">|</span>
          <Link to="/terms-of-service">Terms of Service</Link>
        </div>
        <p>
          &copy; {new Date().getFullYear()} RSVP by Neta Kalif. All rights
          reserved.
        </p>
      </footer>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppDataProvider>
          <AppContent />
        </AppDataProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
