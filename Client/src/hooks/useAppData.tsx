import React, {
  useState,
  useEffect,
  useContext,
  createContext,
  ReactNode,
  useCallback,
} from "react";
import { Guest, Event, EventGuest, Task, BudgetOverview } from "../types";
import { httpRequests } from "../httpClient";
import { useAuth } from "./useAuth";

interface AppDataContextType {
  guests: Guest[];
  events: Event[];
  eventGuestsByEventId: Record<number, EventGuest[]>;
  tasks: Task[];
  budgetOverview: BudgetOverview | null;
  isDataLoading: boolean;
  refreshGuests: () => Promise<void>;
  refreshEvents: () => Promise<void>;
  refreshEventGuests: (eventId: number) => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshBudget: () => Promise<void>;
  setGuests: React.Dispatch<React.SetStateAction<Guest[]>>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setBudgetOverview: React.Dispatch<React.SetStateAction<BudgetOverview | null>>;
  updateEventGuests: (eventId: number, eg: EventGuest[]) => void;
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
}

const AppDataContext = createContext<AppDataContextType | undefined>(undefined);

export const AppDataProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();

  const [guests, setGuests] = useState<Guest[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventGuestsByEventId, setEventGuestsByEventId] = useState<Record<number, EventGuest[]>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [budgetOverview, setBudgetOverview] = useState<BudgetOverview | null>(null);
  const [isDataLoading, setIsDataLoading] = useState(true);

  const updateEventGuests = useCallback((eventId: number, eg: EventGuest[]) => {
    setEventGuestsByEventId(prev => ({ ...prev, [eventId]: eg }));
  }, []);

  const fetchEventGuestsForAll = useCallback(async (evts: Event[]) => {
    const allEventGuests: Record<number, EventGuest[]> = {};
    await Promise.all(evts.map(async (e) => {
      try {
        allEventGuests[e.id] = await httpRequests.getEventGuests(e.id);
      } catch {
        allEventGuests[e.id] = [];
      }
    }));
    setEventGuestsByEventId(allEventGuests);
  }, []);

  useEffect(() => {
    if (!user) {
      setGuests([]);
      setEvents([]);
      setEventGuestsByEventId({});
      setTasks([]);
      setBudgetOverview(null);
      setIsDataLoading(false);
      return;
    }

    const loadAll = async () => {
      setIsDataLoading(true);
      try {
        // Fire budget fetch immediately — it's slow and independent
        const budgetPromise = httpRequests.getBudgetOverview().catch(() => null);

        const [fetchedGuests, fetchedEvents, fetchedTasks] = await Promise.all([
          httpRequests.getGuests(),
          httpRequests.getEvents(),
          httpRequests.getTasks(),
        ]);
        setGuests(fetchedGuests);
        setEvents(fetchedEvents);
        setTasks(fetchedTasks);

        // Fetch event guests and budget in parallel (event guests need event IDs first)
        const [fetchedBudget] = await Promise.all([
          budgetPromise,
          fetchEventGuestsForAll(fetchedEvents),
        ]);
        setBudgetOverview(fetchedBudget);
      } catch (err) {
        console.error("Error loading app data:", err);
      } finally {
        setIsDataLoading(false);
      }
    };

    loadAll();
  }, [user, fetchEventGuestsForAll]);

  const refreshGuests = useCallback(async () => {
    if (!user) return;
    setGuests(await httpRequests.getGuests());
  }, [user]);

  const refreshEvents = useCallback(async () => {
    if (!user) return;
    const data = await httpRequests.getEvents();
    setEvents(data);
    await fetchEventGuestsForAll(data);
  }, [user, fetchEventGuestsForAll]);

  const refreshEventGuests = useCallback(async (eventId: number) => {
    if (!user) return;
    try {
      const eg = await httpRequests.getEventGuests(eventId);
      updateEventGuests(eventId, eg);
    } catch {
      updateEventGuests(eventId, []);
    }
  }, [user, updateEventGuests]);

  const refreshTasks = useCallback(async () => {
    if (!user) return;
    setTasks(await httpRequests.getTasks());
  }, [user]);

  const refreshBudget = useCallback(async () => {
    if (!user) return;
    setBudgetOverview(await httpRequests.getBudgetOverview().catch(() => null));
  }, [user]);

  return (
    <AppDataContext.Provider value={{
      guests, events, eventGuestsByEventId, tasks, budgetOverview,
      isDataLoading,
      refreshGuests, refreshEvents, refreshEventGuests, refreshTasks, refreshBudget,
      setGuests, setTasks, setBudgetOverview, updateEventGuests, setEvents,
    }}>
      {children}
    </AppDataContext.Provider>
  );
};

export const useAppData = (): AppDataContextType => {
  const context = useContext(AppDataContext);
  if (context === undefined) {
    throw new Error("useAppData must be used within an AppDataProvider");
  }
  return context;
};
