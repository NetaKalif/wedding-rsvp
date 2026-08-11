import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from "react";
import Shepherd from "shepherd.js";
import type { StepOptions } from "shepherd.js";
import { httpRequests } from "../httpClient";
import { useAuth } from "./useAuth";
import { useAppData } from "./useAppData";

interface TourContextType {
  isTourActive: boolean;
  startTour: (startStepId?: string) => void;
  autoStartTour: () => void;
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
  const { user, weddingInfo } = useAuth();
  const { enterTourDemoMode, exitTourDemoMode } = useAppData();
  const tourRef = useRef<Shepherd.Tour | null>(null);
  // The complete/cancel handlers are registered once at tour creation — keep
  // the latest exit callback reachable from them
  const exitDemoRef = useRef(exitTourDemoMode);
  exitDemoRef.current = exitTourDemoMode;
  // Auto-start fires at most once per signed-in user per session — otherwise
  // cancelling the tour re-arms the auto-start effect and it pops right back up
  const hasAutoStartedRef = useRef(false);
  const [isTourActive, setIsTourActive] = useState(false);
  const [hasCompletedTour, setHasCompletedTour] = useState(false);
  const [isNewUser, setIsNewUser] = useState(true);
  const [isLoadingTourStatus, setIsLoadingTourStatus] = useState(true);

  // Load tour status from the server whenever the signed-in user changes —
  // the status belongs to the account, so it must not survive a logout/login
  // (e.g. a new user signing in on a browser whose previous user finished the
  // tour would otherwise never get it)
  const userID = user?.userID;
  useEffect(() => {
    if (!userID) {
      // Nobody is signed in — status unknown, block auto-start until login
      setIsLoadingTourStatus(true);
      return;
    }

    let cancelled = false;
    const loadTourStatus = async () => {
      try {
        const tourSeen = await httpRequests.hasTourBeenSeen();
        if (cancelled) return;
        setHasCompletedTour(tourSeen);
        setIsNewUser(!tourSeen);
      } catch (error) {
        console.error("Failed to load tour status:", error);
        // Default to showing tour if we can't fetch status
        if (!cancelled) setIsNewUser(true);
      } finally {
        if (!cancelled) setIsLoadingTourStatus(false);
      }
    };

    // A different user signed in — allow one auto-start for them
    hasAutoStartedRef.current = false;
    loadTourStatus();
    return () => {
      cancelled = true;
    };
  }, [userID]);

  const markTourAsSeenOnServer = useCallback(async () => {
    try {
      await httpRequests.markTourAsSeen();
    } catch (error) {
      console.error("Failed to mark tour as seen on server:", error);
    }
  }, []);

  const startTour = useCallback((startStepId?: string) => {
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
        exitDemoRef.current();
      });

      tourRef.current.on("cancel", () => {
        // Any dismissal counts as "seen" — otherwise the tour auto-starts
        // again on every login until the user finishes it. It can always be
        // relaunched from the help button or the user menu.
        setHasCompletedTour(true);
        setIsNewUser(false);
        markTourAsSeenOnServer();
        setIsTourActive(false);
        exitDemoRef.current();
      });

      // Make tour accessible globally for button actions
      (window as any).shepherdTour = tourRef.current;
    }

    const begin = () => {
      if (startStepId && tourRef.current?.getById(startStepId)) {
        // show() alone doesn't create the dim overlay — only start() does, so
        // set it up manually before jumping into the middle of the tour
        (tourRef.current as any).setupModal?.();
        tourRef.current?.show(startStepId);
      } else {
        tourRef.current?.start();
      }
      setIsTourActive(true);
    };

    // Seed demo rows into empty pages so every step has an anchor; when
    // something was seeded, give React a moment to render it before Shepherd
    // looks for the anchors
    const seededDemoData = enterTourDemoMode();
    if (seededDemoData) {
      setTimeout(begin, 200);
    } else {
      begin();
    }
  }, [tourSteps, markTourAsSeenOnServer, enterTourDemoMode]);

  const endTour = useCallback(() => {
    tourRef.current?.complete();
    setIsTourActive(false);
  }, []);

  const skipTour = useCallback(() => {
    tourRef.current?.cancel();
    setIsTourActive(false);
  }, []);

  // The tour only makes sense once the wedding's basic data exists — the
  // account-level weddingInfo, not a browser-level flag, so a new user on a
  // shared browser doesn't inherit the previous user's setup state
  const hasWeddingSetup = Boolean(
    weddingInfo?.bride_name && weddingInfo?.groom_name && weddingInfo?.date
  );

  // Auto-start tour for new users. Re-evaluated (via TourAutoStarter) when the
  // tour status loads and when the wedding data first appears after setup.
  const autoStartTour = useCallback(() => {
    if (
      !isLoadingTourStatus &&
      isNewUser &&
      !hasCompletedTour &&
      !isTourActive &&
      !hasAutoStartedRef.current
    ) {
      const currentPath = window.location.pathname;

      // Don't start on welcome, login, or admin pages - only on the dashboard
      // and actual feature pages
      const isOnFeaturePage =
        currentPath === "/" ||
        ["/rsvp", "/tasks", "/budget", "/gifts"].some((page) =>
          currentPath.startsWith(page)
        );

      if (hasWeddingSetup && isOnFeaturePage) {
        hasAutoStartedRef.current = true;
        setTimeout(() => {
          startTour();
        }, 1000);
      }
    }
  }, [
    isLoadingTourStatus,
    isNewUser,
    hasCompletedTour,
    isTourActive,
    hasWeddingSetup,
    startTour,
  ]);

  return (
    <TourContext.Provider
      value={{
        isTourActive,
        startTour,
        autoStartTour,
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
