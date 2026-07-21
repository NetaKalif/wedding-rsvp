import React, {
  useState,
  useEffect,
  useContext,
  createContext,
  ReactNode,
  useCallback,
} from "react";
import { User, PartnerInfo, Event } from "../types";
import { googleLogout } from "@react-oauth/google";
import { httpRequests, setAuthToken, setUnauthorizedHandler } from "../httpClient";
import { useNavigate } from "react-router-dom";

interface AuthContextType {
  user: User | undefined;
  partnerInfo: PartnerInfo | undefined;
  weddingInfo: Event | null;
  isAdmin: boolean;
  isLoading: boolean;
  pendingApproval: boolean;
  handleLoginSuccess: (response: any) => void;
  handleLogout: () => void;
  switchUser: (targetUser: User) => void;
  refreshPartnerInfo: () => Promise<void>;
  refreshWeddingInfo: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | undefined>(undefined);
  const [partnerInfo, setPartnerInfo] = useState<PartnerInfo | undefined>(
    undefined
  );
  const [weddingInfo, setWeddingInfo] = useState<Event | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [pendingApproval, setPendingApproval] = useState<boolean>(false);
  const navigate = useNavigate();

  const fetchPartnerInfo = useCallback(async () => {
    try {
      const info = await httpRequests.getPartnerInfo();
      setPartnerInfo(info);
    } catch (error) {
      console.error("Error fetching partner info:", error);
    }
  }, []);

  const fetchWeddingInfo = useCallback(async () => {
    try {
      const info = await httpRequests.getPrimaryEvent();
      setWeddingInfo(info);
      return info;
    } catch (error) {
      console.error("Error fetching wedding info:", error);
      return null;
    }
  }, []);

  const refreshPartnerInfo = useCallback(async () => {
    if (user) {
      await fetchPartnerInfo();
    }
  }, [user, fetchPartnerInfo]);

  const refreshWeddingInfo = useCallback(async () => {
    if (user) {
      await fetchWeddingInfo();
    }
  }, [user, fetchWeddingInfo]);

  const handleLogout = useCallback(() => {
    googleLogout();
    setAuthToken(null);
    setUser(undefined);
    setPartnerInfo(undefined);
    setWeddingInfo(null);
    setIsAdmin(false);
    setPendingApproval(false);
    navigate("/");
  }, [navigate]);

  useEffect(() => {
    setUnauthorizedHandler(handleLogout);
  }, [handleLogout]);

  useEffect(() => {
    const initializeAuth = async () => {
      if (!localStorage.getItem("authToken")) {
        setIsLoading(false);
        return;
      }

      try {
        const [{ user: me, isAdmin: adminStatus }, partnerInfoData, weddingInfoData] =
          await Promise.all([
            httpRequests.getMe(),
            httpRequests.getPartnerInfo(),
            httpRequests.getPrimaryEvent().catch(() => null),
          ]);

        setUser(me);
        setPartnerInfo(partnerInfoData);
        setWeddingInfo(weddingInfoData);
        setIsAdmin(adminStatus);
      } catch (error) {
        console.error("Error initializing auth:", error);
        handleLogout();
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoginSuccess = async (response: any) => {
    setIsLoading(true);
    try {
      const loginResult = await httpRequests.loginWithGoogle(response.credential);

      if (loginResult.status === "pending") {
        setPendingApproval(true);
        return;
      }
      setPendingApproval(false);

      const { token, user: loggedInUser, isAdmin: adminStatus } = loginResult;
      setAuthToken(token);

      // Set user early so useAppData starts fetching in parallel with the auth calls below
      setUser(loggedInUser);

      const [partnerInfoData, weddingInfoData] = await Promise.all([
        httpRequests.getPartnerInfo(),
        httpRequests.getPrimaryEvent().catch(() => null),
      ]);

      setPartnerInfo(partnerInfoData);
      setWeddingInfo(weddingInfoData);
      setIsAdmin(adminStatus);

      navigate("/");
    } finally {
      setIsLoading(false);
    }
  };

  const switchUser = async (targetUser: User) => {
    if (!isAdmin) {
      console.error("Unauthorized: Only admin can switch users");
      return;
    }
    const { token, user: impersonatedUser } = await httpRequests.impersonate(targetUser.userID);
    setAuthToken(token);

    // Fetch all data for the new user
    const [partnerInfoData, weddingInfoData] = await Promise.all([
      httpRequests.getPartnerInfo(),
      httpRequests.getPrimaryEvent().catch(() => null),
    ]);

    setUser(impersonatedUser);
    setPartnerInfo(partnerInfoData);
    setWeddingInfo(weddingInfoData);
    // Admin authority persists through impersonation — isAdmin stays true.
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        partnerInfo,
        weddingInfo,
        isAdmin,
        isLoading,
        pendingApproval,
        handleLoginSuccess,
        handleLogout,
        switchUser,
        refreshPartnerInfo,
        refreshWeddingInfo,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
