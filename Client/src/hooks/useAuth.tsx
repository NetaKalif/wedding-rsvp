import React, {
  useState,
  useEffect,
  useContext,
  createContext,
  ReactNode,
  useCallback,
} from "react";
import { User, PartnerInfo, Event } from "../types";
import { jwtDecode } from "jwt-decode";
import { googleLogout } from "@react-oauth/google";
import { httpRequests } from "../httpClient";
import { useNavigate } from "react-router-dom";

interface AuthContextType {
  user: User | undefined;
  partnerInfo: PartnerInfo | undefined;
  weddingInfo: Event | null;
  isAdmin: boolean;
  isLoading: boolean;
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
  const navigate = useNavigate();

  const fetchPartnerInfo = useCallback(async (userID: string) => {
    try {
      const info = await httpRequests.getPartnerInfo(userID);
      setPartnerInfo(info);
    } catch (error) {
      console.error("Error fetching partner info:", error);
    }
  }, []);

  const fetchWeddingInfo = useCallback(async (userID: string) => {
    try {
      const info = await httpRequests.getPrimaryEvent(userID);
      setWeddingInfo(info);
      return info;
    } catch (error) {
      console.error("Error fetching wedding info:", error);
      return null;
    }
  }, []);

  const refreshPartnerInfo = useCallback(async () => {
    if (user) {
      await fetchPartnerInfo(user.userID);
    }
  }, [user, fetchPartnerInfo]);

  const refreshWeddingInfo = useCallback(async () => {
    if (user) {
      await fetchWeddingInfo(user.userID);
    }
  }, [user, fetchWeddingInfo]);

  useEffect(() => {
    const initializeAuth = async () => {
      const storedUser = localStorage.getItem("loggedInUser");

      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        const oneWeekInMs = 7 * 24 * 60 * 60 * 1000;

        if (Date.now() - parsedUser.loginTime < oneWeekInMs) {
          const { loginTime, ...userWithoutLoginTime } = parsedUser;

          setUser(userWithoutLoginTime);

          // Fetch all data before setting state to batch updates
          const [partnerInfoData, adminStatus, weddingInfoData] =
            await Promise.all([
              httpRequests.getPartnerInfo(userWithoutLoginTime.userID),
              httpRequests
                .checkAdmin(userWithoutLoginTime.userID)
                .catch(() => false),
              httpRequests
                .getPrimaryEvent(userWithoutLoginTime.userID)
                .catch(() => null),
            ]);

          // Batch all state updates together
          setPartnerInfo(partnerInfoData);
          setWeddingInfo(weddingInfoData);
          setIsAdmin(adminStatus);
          setIsLoading(false);
          return;
        } else {
          localStorage.removeItem("loggedInUser");
        }
      }
      setIsLoading(false);
    };

    initializeAuth();
  }, []);

  const checkAdminStatus = async (userID: string) => {
    try {
      const adminStatus = await httpRequests.checkAdmin(userID);
      setIsAdmin(adminStatus);
    } catch (error) {
      console.error("Error checking admin status:", error);
      setIsAdmin(false);
    }
  };

  const handleLoginSuccess = async (response: any) => {
    setIsLoading(true);
    const decoded: any = jwtDecode(response.credential);
    const loggedInUser = {
      name: decoded.name,
      email: decoded.email,
      userID: decoded.sub,
    };
    await httpRequests.addUser(loggedInUser);

    // Fetch all data before setting state to batch updates
    const [partnerInfoData, adminStatus, weddingInfoData] = await Promise.all([
      httpRequests.getPartnerInfo(loggedInUser.userID),
      httpRequests.checkAdmin(loggedInUser.userID).catch(() => false),
      httpRequests.getPrimaryEvent(loggedInUser.userID).catch(() => null),
    ]);

    // Batch all state updates together
    setUser(loggedInUser);
    setPartnerInfo(partnerInfoData);
    setWeddingInfo(weddingInfoData);
    setIsAdmin(adminStatus);
    setIsLoading(false);

    localStorage.setItem(
      "loggedInUser",
      JSON.stringify({ ...loggedInUser, loginTime: Date.now() })
    );
    navigate("/");
  };

  const handleLogout = () => {
    googleLogout();
    setUser(undefined);
    setPartnerInfo(undefined);
    setWeddingInfo(null);
    setIsAdmin(false);
    localStorage.removeItem("loggedInUser");
    navigate("/");
  };

  const switchUser = async (targetUser: User) => {
    if (!isAdmin) {
      console.error("Unauthorized: Only admin can switch users");
      return;
    }
    const userWithLoginTime = { ...targetUser, loginTime: Date.now() };
    localStorage.setItem("loggedInUser", JSON.stringify(userWithLoginTime));

    // Fetch all data for the new user
    const [partnerInfoData, weddingInfoData] = await Promise.all([
      httpRequests.getPartnerInfo(targetUser.userID),
      httpRequests.getPrimaryEvent(targetUser.userID).catch(() => null),
    ]);

    setUser(targetUser);
    setPartnerInfo(partnerInfoData);
    setWeddingInfo(weddingInfoData);
    checkAdminStatus(targetUser.userID);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        partnerInfo,
        weddingInfo,
        isAdmin,
        isLoading,
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
