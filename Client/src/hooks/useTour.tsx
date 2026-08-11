import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from "react";
import Shepherd from "shepherd.js";
import type { StepOptions } from "shepherd.js";
import { httpRequests } from "../httpClient";

interface TourContextType {
  isTourActive: boolean;
  startTour: () => void;
  endTour: () => void;
  skipTour: () => void;
  hasCompletedTour: boolean;
  setHasCompletedTour: (value: boolean) => void;
  isNewUser: boolean;
  setIsNewUser: (value: boolean) => void;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

export function useTour() {
  const context = useContext(TourContext);
  if (!context) {
    throw new Error("useTour must be used within a TourProvider");
  }
  return context;
}

interface TourProviderProps {
  children: ReactNode;
  tourSteps: StepOptions[];
}

export function TourProvider({ children, tourSteps }: TourProviderProps) {
  const tourRef = useRef<Shepherd.Tour | null>(null);
  const [isTourActive, setIsTourActive] = useState(false);
  const [hasCompletedTour, setHasCompletedTour] = useState(false);
  const [isNewUser, setIsNewUser] = useState(true);
  const [isLoadingTourStatus, setIsLoadingTourStatus] = useState(true);

  // Load tour status from server on mount
  useEffect(() => {
    const loadTourStatus = async () => {
      try {
        const tourSeen = await httpRequests.hasTourBeenSeen();
        setHasCompletedTour(tourSeen);
        setIsNewUser(!tourSeen);
      } catch (error) {
        console.error("Failed to load tour status:", error);
        // Default to showing tour if we can't fetch status
        setIsNewUser(true);
      } finally {
        setIsLoadingTourStatus(false);
      }
    };

    loadTourStatus();
  }, []);

  const startTour = useCallback(() => {
    if (!tourRef.current) {
      tourRef.current = new Shepherd.Tour({
        useModalOverlay: true,
        defaultStepOptions: {
          classes: "shepherd-theme-custom",
          scrollTo: { behavior: "smooth", block: "center" },
          cancelIcon: {
            enabled: true,
          },
        },
      });

      tourSteps.forEach((step: any) => {
        const stepWithIcon = { ...step };
        if (step.icon) {
          stepWithIcon.title = `${step.icon}\n${step.title}`;
        }
        tourRef.current?.addStep(stepWithIcon);
      });

      tourRef.current.on("complete", () => {
        setHasCompletedTour(true);
        setIsNewUser(false);
        markTourAsSeenOnServer();
        setIsTourActive(false);
      });

      tourRef.current.on("cancel", () => {
        setIsTourActive(false);
        // Only mark as seen if they explicitly completed, not if they just closed it
      });

      // Make tour accessible globally for button actions
      (window as any).shepherdTour = tourRef.current;
    }

    tourRef.current?.start();
    setIsTourActive(true);
  }, [tourSteps]);

  const markTourAsSeenOnServer = useCallback(async () => {
    try {
      await httpRequests.markTourAsSeen();
    } catch (error) {
      console.error("Failed to mark tour as seen on server:", error);
    }
  }, []);

  const endTour = useCallback(() => {
    tourRef.current?.complete();
    setIsTourActive(false);
  }, []);

  const skipTour = useCallback(() => {
    tourRef.current?.cancel();
    setIsTourActive(false);
  }, []);

  // Auto-start tour for new users (only after status is loaded and user has set up wedding info)
  const autoStartTour = useCallback(() => {
    if (!isLoadingTourStatus && isNewUser && !hasCompletedTour && !isTourActive) {
      // Only start tour if user has completed initial setup
      const hasWeddingInfo = localStorage.getItem("wedding_setup_complete");
      const currentPath = window.location.hash;

      // Don't start on welcome, login, or home pages - only on actual feature pages
      const isOnFeaturePage = currentPath.includes("/rsvp") ||
                              currentPath.includes("/tasks") ||
                              currentPath.includes("/budget") ||
                              currentPath.includes("/gifts") ||
                              (currentPath === "" || currentPath === "#/");

      if (hasWeddingInfo && isOnFeaturePage) {
        setTimeout(() => {
          startTour();
        }, 1000);
      }
    }
  }, [isLoadingTourStatus, isNewUser, hasCompletedTour, isTourActive, startTour]);

  return (
    <TourContext.Provider
      value={{
        isTourActive,
        startTour,
        endTour,
        skipTour,
        hasCompletedTour,
        setHasCompletedTour,
        isNewUser,
        setIsNewUser,
      }}
    >
      <TourAutoStarter onAutoStart={autoStartTour} />
      {children}
    </TourContext.Provider>
  );
}

// Helper component to trigger tour auto-start
function TourAutoStarter({ onAutoStart }: { onAutoStart: () => void }) {
  useEffect(() => {
    onAutoStart();
  }, [onAutoStart]);

  return null;
}
